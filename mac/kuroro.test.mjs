import { describe, expect, it, vi } from 'vitest';
import { GARDER, MODELE, OLLAMA, PAS_ACTIF_MS, PAS_REPOS_MS, adresseSuivante, apresPassage, boucle, cadenceInitiale, demanderOllama, lireContenu, prechauffer, prochainPas, signaux, tour } from './kuroro.mjs';
import { MODELE_LOCAL } from '../src/sim/kuroro-ia';

const demande = { id: 'abc-1', messages: [{ role: 'moi', texte: 'vide le cache de mon Mac' }, { role: 'kuroro', texte: 'ok' }, { role: 'moi', texte: 'merci' }], systeme: 'SYSTEME + faits', format: { type: 'object' }, modele: 'qwen3:8b', reste_ms: 27_000 };

/** Un faux QG : une file de demandes et les réponses reçues. */
function faux(demandes = [demande]) {
  const recues = [];
  const appeler = vi.fn(async (methode, commande, corps) => {
    if (methode === 'GET' && commande.startsWith('suivante')) return { eveil: false, demande: demandes.shift() ?? null };
    if (methode === 'POST' && commande === 'reponse') { recues.push(corps); return { ok: true }; }
    throw new Error('inattendu');
  });
  return { appeler, recues };
}

describe('Kuroro (Mac) : un tour', () => {
  it('rien à faire : Ollama n’est pas appelé', async () => {
    const { appeler } = faux([]);
    const ollama = vi.fn();
    expect(await tour({ appeler, ollama })).toEqual({ statut: 'vide', eveil: false, isaac: false });
    expect(ollama).not.toHaveBeenCalled();
  });

  it('une demande : Ollama répond en JSON, la réponse (et la mission) part au QG', async () => {
    const { appeler, recues } = faux();
    const ollama = vi.fn(async () => '{"texte":"D’accord.","mission":{"agent":"isaac","mission":"Vider le cache du Mac"}}');
    expect((await tour({ appeler, ollama })).statut).toBe('reponse');
    expect(ollama).toHaveBeenCalledWith(demande);
    expect(recues).toEqual([{ id: 'abc-1', texte: 'D’accord.', mission: { agent: 'isaac', mission: 'Vider le cache du Mac' } }]);
  });

  it('Ollama hors format, absent ou trop lent : « echec » tout de suite (la page reprend ses règles), journal sans texte', async () => {
    for (const ollama of [async () => 'Voici {"texte":', async () => { throw new TypeError('fetch failed'); }, async () => { throw new DOMException('t', 'TimeoutError'); }]) {
      const { appeler, recues } = faux();
      const journal = vi.fn();
      expect((await tour({ appeler, ollama, journal })).statut).toBe('echec');
      expect(recues).toEqual([{ id: 'abc-1', echec: true }]);
      expect(journal.mock.calls.flat().join(' ')).not.toMatch(/cache|merci/);
    }
  });

  it('lireContenu : JSON, texte simple, ou rien', () => {
    expect(lireContenu('{"texte":"Salut !","mission":null}')).toEqual({ texte: 'Salut !', mission: null });
    expect(lireContenu('{"texte":"Salut !"}')).toEqual({ texte: 'Salut !', mission: null });
    expect(lireContenu('Salut patron.')).toEqual({ texte: 'Salut patron.', mission: null });
    expect(lireContenu('{"mission":null}')).toBeNull();
    expect(lireContenu('[1]')).toBeNull();
    expect(lireContenu('')).toBeNull();
  });
});

describe('Kuroro (Mac) : Ollama', () => {
  it('appelle /api/chat avec le modèle, le format JSON, le prompt du serveur et la conversation', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ message: { content: '{"texte":"ok","mission":null}' } })));
    expect(await demanderOllama(demande, f)).toBe('{"texte":"ok","mission":null}');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    const corps = JSON.parse(init.body);
    expect(corps).toMatchObject({ model: 'qwen3:8b', stream: false, think: false, format: { type: 'object' }, keep_alive: '2h', options: { num_ctx: 8192 } });
    expect(corps.messages).toEqual([
      { role: 'system', content: 'SYSTEME + faits' },
      { role: 'user', content: 'vide le cache de mon Mac' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'merci' },
    ]);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('coupé au délai', async () => {
    const f = vi.fn((_, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason))));
    await expect(demanderOllama({ ...demande, reste_ms: 2_000 }, f, 30)).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('une erreur d’Ollama remonte', async () => {
    await expect(demanderOllama(demande, async () => new Response('', { status: 500 }))).rejects.toThrow('ollama 500');
  });
});

describe('Kuroro (Mac) : la cadence (peu d’appels au repos)', () => {
  const T = 1_800_000_000_000; // un multiple de 5 min
  it('au repos : 20 s ; réveillé par la page : 1,5 s pendant 2 min ; après une demande : 1,5 s pendant 1 min', () => {
    const c0 = cadenceInitiale();
    expect(prochainPas(c0, T)).toBe(PAS_REPOS_MS);
    expect(PAS_REPOS_MS).toBe(20_000);
    const eveille = apresPassage(c0, { eveil: true, demande: false }, T);
    expect(prochainPas(eveille, T + 119_000)).toBe(PAS_ACTIF_MS);
    expect(prochainPas(eveille, T + 121_000)).toBe(PAS_REPOS_MS);
    const apres = apresPassage(c0, { eveil: false, demande: true }, T);
    expect(prochainPas(apres, T + 59_000)).toBe(PAS_ACTIF_MS);
    expect(prochainPas(apres, T + 61_000)).toBe(PAS_REPOS_MS);
    // une demande ne raccourcit jamais un réveil plus long
    expect(apresPassage(eveille, { eveil: false, demande: true }, T + 1_000).rapideJusqua).toBe(T + 120_000);
  });

  it('les signaux : « vu » seulement réveillé et une fois par tranche de 10 s ; « allume » une fois par tranche de 5 min', () => {
    let c = cadenceInitiale();
    let s = signaux(c, T);
    expect([s.vu, s.allume]).toEqual([false, true]);
    c = s.suivant;
    expect(signaux(c, T + 20_000)).toMatchObject({ vu: false, allume: false });
    c = apresPassage(c, { eveil: true, demande: false }, T + 20_000);
    s = signaux(c, T + 21_500); expect(s.vu).toBe(true); c = s.suivant;
    expect(signaux(c, T + 23_000).vu).toBe(false); // même tranche de 10 s : rien n'est réécrit
    expect(signaux(c, T + 30_500).vu).toBe(true);
    expect(signaux(c, T + 5 * 60_000).allume).toBe(true);
  });

  it('l’adresse : « suivante », « suivante?vu=1 », « suivante?vu=1&allume=1 »', () => {
    expect(adresseSuivante({ vu: false, allume: false })).toBe('suivante');
    expect(adresseSuivante({ vu: true, allume: false })).toBe('suivante?vu=1');
    expect(adresseSuivante({ vu: true, allume: true })).toBe('suivante?vu=1&allume=1');
  });

  it('au repos, une journée : < 5 000 commandes au QG (1 par passage + le battement de 5 min)', () => {
    let c = cadenceInitiale(), t = T, commandes = 0;
    while (t < T + 86_400_000) {
      const s = signaux(c, t);
      commandes += 1 + (s.vu ? 1 : 0) + (s.allume ? 1 : 0);
      c = apresPassage(s.suivant, { eveil: false, demande: false }, t);
      t += prochainPas(c, t);
    }
    expect(commandes).toBe(4_320 + 288);
    expect(commandes).toBeLessThan(5_000);
  });
});

describe('Kuroro (Mac) : la boucle', () => {
  it('continue malgré un QG injoignable, se réveille quand la page le demande, ne journalise que les changements', async () => {
    let t = 1_800_000_000_000, n = 0;
    const pas = [], adresses = [];
    const appels = [() => { throw new Error('statut 502'); }, () => { throw new Error('statut 502'); }, () => ({ eveil: true, demande: null }), () => ({ eveil: false, demande }), () => ({ eveil: false, demande: null })];
    const appeler = vi.fn(async (m, a) => { if (m !== 'GET') return { ok: true }; adresses.push(a); return appels[n++](); });
    const journal = vi.fn();
    await boucle({
      appeler, ollama: async () => '{"texte":"ok","mission":null}', journal,
      now: () => t, attendre: async ms => { pas.push(ms); t += ms; }, continuer: () => n < appels.length,
    });
    expect(pas).toEqual([PAS_REPOS_MS, PAS_REPOS_MS, PAS_ACTIF_MS, PAS_ACTIF_MS, PAS_ACTIF_MS]);
    expect(adresses).toEqual(['suivante?allume=1', 'suivante?allume=1', 'suivante?allume=1', 'suivante?vu=1', 'suivante']);
    expect(journal.mock.calls.map(c => c[0])).toEqual(['QG injoignable (statut 502)', 'réveillé', 'demande traitée : reponse', 'réveillé']);
  });

  it('fait lire le prompt à l’avance à chaque réveil de la page (le serveur n’en envoie qu’un par 30 s)', async () => {
    let t = 1_800_000_000_000, n = 0;
    const p = { modele: 'qwen3:8b', systeme: 'REGLES + faits' };
    const appels = [{ eveil: true, prechauffage: p }, { eveil: false }, { eveil: true, prechauffage: p }, { eveil: false }];
    const prechauffer = vi.fn(async () => {});
    await boucle({
      appeler: async () => ({ demande: null, ...appels[n++] }), ollama: async () => '', prechauffer,
      now: () => t, attendre: async ms => { t += ms; }, continuer: () => n < appels.length,
    });
    expect(prechauffer.mock.calls).toEqual([[p], [p]]);
  });

  it('le préchauffage envoie le prompt seul, garde le modèle chargé, et ne fait écrire qu’un jeton', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    await prechauffer(f, { modele: 'qwen3:8b', systeme: 'REGLES + faits' });
    const [adresse, init] = f.mock.calls[0];
    const corps = JSON.parse(init.body);
    expect(adresse).toBe(`${OLLAMA}/api/chat`);
    expect(corps).toMatchObject({ model: 'qwen3:8b', stream: false, think: false, keep_alive: GARDER, messages: [{ role: 'system', content: 'REGLES + faits' }], options: { num_ctx: 8192, num_predict: 1 } });
  });

  it('le modèle préchauffé est celui que le QG demande', () => {
    expect(MODELE).toBe(MODELE_LOCAL);
  });

  it('une mission pour Isaac : le relais est lancé tout de suite', async () => {
    let t = 1_800_000_000_000, n = 0;
    const appels = [{ isaac: true }, {}];
    const lancerIsaac = vi.fn(async () => {});
    await boucle({
      appeler: async () => ({ demande: null, ...appels[n++] }), ollama: async () => '', lancerIsaac,
      now: () => t, attendre: async ms => { t += ms; }, continuer: () => n < appels.length,
    });
    expect(lancerIsaac).toHaveBeenCalledTimes(1);
  });
});
