import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Le chiffrement des jetons gardés dans Upstash (LinkedIn, Spotify) : AES-256-GCM, la clé est le SHA-256 du secret
// de l'application. Le texte chiffré contient l'IV (12 octets), l'étiquette (16 octets) puis les données, en base64.

const cle = (secret: string) => createHash('sha256').update(secret).digest();

export function chiffrer(clair: string, secret: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', cle(secret), iv);
  const donnees = Buffer.concat([c.update(clair, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), donnees]).toString('base64');
}

/** Lève si le texte a été modifié ou chiffré avec un autre secret. */
export function dechiffrer(b64: string, secret: string) {
  const b = Buffer.from(b64, 'base64');
  const d = createDecipheriv('aes-256-gcm', cle(secret), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
