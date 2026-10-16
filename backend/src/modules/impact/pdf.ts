const winAnsi: Record<string, string> = {
  'á': '\\341', 'é': '\\351', 'í': '\\355', 'ó': '\\363', 'ú': '\\372', 'ñ': '\\361',
  'Á': '\\301', 'É': '\\311', 'Í': '\\315', 'Ó': '\\323', 'Ú': '\\332', 'Ñ': '\\321',
  'ü': '\\374', 'Ü': '\\334', '¿': '\\277', '¡': '\\241',
}

function pdfText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, (character) => winAnsi[character] ?? '?')
}

export function renderReportPdf(lines: string[]): Buffer {
  const commands = ['BT', '/F1 11 Tf', '48 800 Td', '14 TL']
  lines.slice(0, 48).forEach((line, index) => {
    const text = pdfText(line).slice(0, 110)
    commands.push(index === 0 ? `(${text}) Tj` : `T* (${text}) Tj`)
  })
  commands.push('ET')
  const stream = commands.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf)
}

export function renderReportCsv(rows: Array<{ section: string; indicator: string; value: string; unit: string; evidence: string; limitations: string }>): string {
  const header = ['seccion', 'indicador', 'valor', 'unidad', 'evidencia', 'limitaciones']
  const body = rows.map((row) => [row.section, row.indicator, row.value, row.unit, row.evidence, row.limitations].map(csvCell).join(','))
  return `\uFEFF${[header.join(','), ...body].join('\n')}\n`
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}
