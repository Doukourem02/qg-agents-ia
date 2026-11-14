import 'server-only';
import type { Accord } from './accords';
import { texteDemande } from './accords';
import { envoyerTelegram } from './telegram';
import { envoyerTexte } from './whatsapp';

// Le canal de mes accords et alertes : Telegram s'il est configuré, sinon WhatsApp.
// Les agents ne savent pas lequel ; on bascule en changeant seulement les réglages.

export const canal = () => (process.env.TELEGRAM_TOKEN ? 'telegram' : 'whatsapp');

export async function envoyerDemande(a: Accord) {
  if (canal() === 'telegram') {
    return envoyerTelegram(texteDemande(a).replace('Réponds OK, non, ou « modifie : … »', 'Touche un bouton, ou écris « modifie : … »'), [
      { texte: '✅ OK', donnee: `ok:${a.id}` },
      { texte: '❌ Non', donnee: `non:${a.id}` },
    ]);
  }
  return envoyerTexte(texteDemande(a));
}

export async function envoyerMessage(texte: string) {
  return canal() === 'telegram' ? envoyerTelegram(texte) : envoyerTexte(texte);
}
