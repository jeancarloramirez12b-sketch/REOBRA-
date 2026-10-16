import assert from 'node:assert/strict'
import test from 'node:test'
import { isLocalPassportUrl, passportQrSvg, passportUrl } from './qr.js'

test('el QR usa la ruta pública y no incluye secretos', async () => {
  const url = passportUrl('http://localhost:5173', 'rob_0123456789abcdef0123')
  assert.equal(url, 'http://localhost:5173/pasaporte/rob_0123456789abcdef0123')
  assert.equal(url.includes('token'), false)
  assert.equal(url.includes('password'), false)
  assert.equal(isLocalPassportUrl(url), true)
  assert.equal(isLocalPassportUrl(passportUrl('https://reobra.example', 'rob_0123456789abcdef0123')), false)
  const svg = await passportQrSvg(url)
  assert.equal(svg.includes('<svg'), true)
  assert.equal(svg.includes('reobra_session'), false)
  assert.equal(svg.includes('una-clave'), false)
})
