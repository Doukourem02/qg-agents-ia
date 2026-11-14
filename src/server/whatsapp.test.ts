import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const { messagesRecus, mesNumeros, signatureValide } = await import('./whatsapp');

describe('le webhook WhatsApp', () => {
  it('accepte seulement la signature de Meta', () => {
    process.env.WHATSAPP_APP_SECRET = 'secret-de-test';
    const corps = '{"a":1}';
    const bonne = 'sha256=' + createHmac('sha256', 'secret-de-test').update(corps).digest('hex');
    expect(signatureValide(corps, bonne)).toBe(true);
    expect(signatureValide(corps + ' ', bonne)).toBe(false);
    expect(signatureValide(corps, 'sha256=00')).toBe(false);
    expect(signatureValide(corps, null)).toBe(false);
  });
  it('extrait les messages texte et ignore le reste', () => {
    const notif = { entry: [{ changes: [{ value: {
      messages: [{ id: 'm1', from: '2250700000000', type: 'text', text: { body: 'OK' } }, { id: 'm2', from: '2250700000000', type: 'image' }],
      statuses: [{ id: 's1' }],
    } }] }] };
    expect(messagesRecus(notif)).toEqual([{ id: 'm1', de: '2250700000000', texte: 'OK' }]);
  });
  it('reconnaît mon numéro ivoirien sous ses deux formes, et seulement lui', () => {
    const moi = mesNumeros('2250778733971');
    expect(moi.has('2250778733971')).toBe(true);
    expect(moi.has('22578733971')).toBe(true);
    expect(moi.has('22578733972')).toBe(false);
    expect(mesNumeros('33612345678').size).toBe(1);
  });
});
