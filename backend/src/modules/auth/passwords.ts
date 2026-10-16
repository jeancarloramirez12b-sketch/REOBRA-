import argon2 from 'argon2'

const argonOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

let paddingHash: Promise<string> | null = null

function padding(): Promise<string> {
  paddingHash ??= argon2.hash('reobra-timing-padding', argonOptions)
  return paddingHash
}

export function passwordProblem(password: string, email: string): string | null {
  if (password.length < 12) {
    return 'La contraseña debe tener al menos 12 caracteres.'
  }
  if (password.length > 128) {
    return 'La contraseña no puede superar 128 caracteres.'
  }
  if (password !== password.trim()) {
    return 'La contraseña no puede empezar ni terminar con espacios.'
  }
  if (password.toLowerCase() === email.toLowerCase()) {
    return 'La contraseña no puede ser igual al correo.'
  }

  return null
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, argonOptions)
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password)
  } catch {
    await padding()
    return false
  }
}

export async function consumePasswordCheck(password: string): Promise<void> {
  const hash = await padding()
  await argon2.verify(hash, password).catch(() => false)
}
