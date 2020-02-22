const ToST = require('./lib').default

const toST = new ToST({
  outputZoom: 1,
  inputZoom: 3
})

toST.buildTiles()






// const { S2Point, S2LonLat, bboxST } = require('s2projection')
// const SphericalMercator = require('@mapbox/sphericalmercator')
//
// const LAT_BOUND = 85.05
// const ZOOM = 3
// const TILE_SIZE = 512
// const MAX_PIXEL_SIZE = (1 << ZOOM) * TILE_SIZE
// console.log('MAX_PIXEL_SIZE', MAX_PIXEL_SIZE)
//
// /** MERCATOR TESTS **/
// const merc = new SphericalMercator({
//   size: 512
// })
//
// const px = merc.px([180, -LAT_BOUND], ZOOM, true, '900913')
// if (px[0] >= MAX_PIXEL_SIZE) px[0] = MAX_PIXEL_SIZE - 1
// if (px[1] >= MAX_PIXEL_SIZE) px[1] = MAX_PIXEL_SIZE - 1
// console.log(px)
//
// const tileX = Math.floor(px[0] / TILE_SIZE)
// const tileY = Math.floor(px[1] / TILE_SIZE)
//
// const tileXPos = px[0] % TILE_SIZE
// const tileYPos = px[1] % TILE_SIZE
//
// console.log('tile', tileX, tileY)
// console.log('tile pos', tileXPos, tileYPos)

// const bbox = bboxST(0, 0, 0)
//
//
// for (let j = 0; j < 512; j++) {
//   for (let i = 0; i < 512; i++) {
//     const s = bbox[0] + i * (bbox[2] - bbox[0]) / 512
//     const t = bbox[1] + j * (bbox[3] - bbox[1]) / 512
//     console.log(s, t)
//   }
// }

// low2 + (value - low1) * (high2 - low2) / (high1 - low1)
