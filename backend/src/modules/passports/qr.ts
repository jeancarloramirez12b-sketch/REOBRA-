import QRCode from 'qrcode'

export function passportUrl(frontendOrigin: string, publicCode: string): string {
  const origin = frontendOrigin.replace(/\/$/, '')
  return `${origin}/pasaporte/${publicCode}`
}

export function isLocalPassportUrl(url: string): boolean {
  const host = new URL(url).hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
}

export async function passportQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#d7fff1', light: '#070b11' },
  })
}
