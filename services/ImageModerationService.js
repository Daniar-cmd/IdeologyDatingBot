const fs = require('fs')
const path = require('path')

const tf = require('@tensorflow/tfjs');
const Jimp = require('jimp')
const jsQR = require('jsqr')

// Классы NSFW-модели (порядок фиксирован моделью)
const NSFW_CLASSES = ['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy']

const MODEL_DIR = path.join(__dirname, '..', 'assets', 'nsfw')

// Пороговые значения: пропускаем Drawing/Neutral, режем явный контент
const NSFW_THRESHOLDS = {
    Porn: 0.5,
    Hentai: 0.5,
    Sexy: 0.5
}

// Читает model.json + веса из локальной папки и отдаёт IOHandler для tfjs.
// Весовой файл квантован (uint8), поэтому спецификации передаются как есть,
// а буфер дополняется до кратности 4 байтам (требование tfjs).
function buildModelIOHandler(modelDir) {
    const model = JSON.parse(fs.readFileSync(path.join(modelDir, 'model.json'), 'utf8'))

    const weightSpecs = []
    for (const group of model.weightsManifest) {
        for (const spec of group.weights) {
            weightSpecs.push(spec)
        }
    }

    const shards = model.weightsManifest.map(group => group.paths).flat()
    const buffers = shards.map(name => {
        const file = fs.readFileSync(path.join(modelDir, name))
        return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    })

    const total = buffers.reduce((sum, buf) => sum + buf.byteLength, 0)
    const weightData = new ArrayBuffer(Math.ceil(total / 4) * 4)
    const view = new Uint8Array(weightData)
    let offset = 0
    for (const buf of buffers) {
        view.set(new Uint8Array(buf), offset)
        offset += buf.byteLength
    }

    return {
        async load() {
            return { modelTopology: model.modelTopology, weightSpecs, weightData }
        }
    }
}

class ImageModerationService {
    constructor(bot) {
        this.bot = bot
        this.modelPromise = null
    }

    // Модель грузится один раз (лениво) и переиспользуется
    getModel() {
        if (!this.modelPromise) {
            this.modelPromise = tf.loadLayersModel(buildModelIOHandler(MODEL_DIR))
        }

        return this.modelPromise
    }

    async load() {
        await this.getModel()
    }

    // Скачивает фото по file_id и проверяет его.
    // Возвращает { ok: true } либо { ok: false, reason: 'qr' | 'nsfw' }.
    // Если анализ не удался (сеть/формат), пропускаем фото, но пишем в лог.
    async moderateFile(fileID) {
        let buffer

        try {
            const link = await this.bot.getFileLink(fileID)
            const response = await fetch(link)

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }

            buffer = Buffer.from(await response.arrayBuffer())
        } catch (error) {
            console.error('Ошибка загрузки фото для модерации:', error.message)
            return { ok: true }
        }

        return this.moderateImage(buffer)
    }

    // Проверяет изображение: QR-код и NSFW-контент.
    async moderateImage(buffer) {
        let image

        try {
            image = await Jimp.read(buffer)
        } catch (error) {
            console.error('Фото не читается как изображение:', error.message)
            return { ok: true }
        }

        // Крупные изображения уменьшаем, чтобы анализ не съедал память
        const maxSide = 1600
        if (Math.max(image.bitmap.width, image.bitmap.height) > maxSide) {
            image.resize(maxSide, maxSide, Jimp.RESIZE_BILINEAR)
        }

        const qrValue = this.detectQR(image)

        if (qrValue) {
            return { ok: false, reason: 'qr' }
        }

        const labels = await this.classifyNSFW(image)

        if (!labels) {
            return { ok: true }
        }

        const verdict = this.decide(labels)

        if (!verdict.ok) {
            return { ok: false, reason: 'nsfw', detail: verdict.label }
        }

        return { ok: true }
    }

    detectQR(image) {
        const code = jsQR(
            new Uint8ClampedArray(image.bitmap.data),
            image.bitmap.width,
            image.bitmap.height
        )

        return code ? code.data : null
    }

    // Прогоняет изображение через NSFW-модель и возвращает вероятности по классам.
    // null — если модель недоступна или произошла ошибка (пропускаем фото).
    async classifyNSFW(image) {
        try {
            const model = await this.getModel()
            const tensor = this.imageToTensor(image)

            let values

            try {
                const logits = tf.tidy(() => {
                    const size = model.inputs[0].shape[1]
                    const normalized = tensor.toFloat().div(255)
                    let resized = normalized

                    if (tensor.shape[0] !== size || tensor.shape[1] !== size) {
                        resized = tf.image.resizeBilinear(normalized, [size, size], true)
                    }

                    return model.predict(resized.reshape([1, size, size, 3]))
                })

                values = Array.from(await logits.data())
                logits.dispose()
            } finally {
                tensor.dispose()
            }

            return values.map((probability, index) => ({
                className: NSFW_CLASSES[index] || String(index),
                probability
            }))
        } catch (error) {
            console.error('Ошибка NSFW-анализа:', error.message)
            return null
        }
    }

    imageToTensor(image) {
        const { data, width, height } = image.bitmap
        const rgb = new Uint8Array(width * height * 3)

        for (let i = 0, j = 0; i < data.length; i += 4) {
            rgb[j++] = data[i]
            rgb[j++] = data[i + 1]
            rgb[j++] = data[i + 2]
        }

        return tf.tensor3d(rgb, [height, width, 3])
    }

    // Политика: отклоняем явный сексуальный контент (Porn/Hentai/Sexy).
    decide(predictions) {
        for (const { className, probability } of predictions) {
            const threshold = NSFW_THRESHOLDS[className]

            if (threshold !== undefined && probability >= threshold) {
                return { ok: false, label: className }
            }
        }

        return { ok: true }
    }
}

module.exports = ImageModerationService