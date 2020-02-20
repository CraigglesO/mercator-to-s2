const fs = require('fs')
const PNG = require('pngjs').PNG

const data = fs.readFileSync('./img/2/0/0.png')
const png = PNG.sync.read(data)
console.log('png', png)

const idx = (512 * 0 + 2) << 2
console.log('rgba', png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3])
// const options = { colorType: 6 }
// const buffer = PNG.sync.write(png, options)
// fs.writeFileSync('out.png', buffer)
