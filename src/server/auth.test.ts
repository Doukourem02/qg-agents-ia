import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { agentDeLaRoute, pageSeulement, verifierAgent } = await import('./auth');

const req = (chemin: string, entetes: Record<string, string> = {}) => new Request(`https://qg.test${chemin}`, { headers: entetes });
afterEach(() => vi.unstubAllEnvs());

describe('les entrées de la page', () => {
  it('mon navigateur passe ; le laissez-passer des routines et la clé des agents sont refusés (403)', () => {
    expect(pageSeulement(req('/api/etat'))).toBeNull();
    expect(pageSeulement(req('/api/missions', { 'x-vercel-protection-bypass': 'x' }))?.status).toBe(403);
    expect(pageSeulement(req('/api/feu', { authorization: 'Bearer x' }))?.status).toBe(403);
    expect(pageSeulement(req('/api/etat?x-vercel-protection-bypass=x'))?.status).toBe(403);
  });
});

describe('la preuve d\'agent', () => {
  it('la clé commune ou le laissez-passer ; sinon 401 ; rien de configuré : 503', () => {
    expect(() => verifierAgent(req('/api/agents/lea/rapport'))).toThrow(/non configurée/);
    vi.stubEnv('QG_CLE_AGENTS', 'cle'); vi.stubEnv('QG_PASSE_AGENTS', 'passe');
    expect(() => verifierAgent(req('/api/agents/lea/rapport', { authorization: 'Bearer cle' }))).not.toThrow();
    expect(() => verifierAgent(req('/api/agents/lea/rapport', { 'x-vercel-protection-bypass': 'passe' }))).not.toThrow();
    expect(() => verifierAgent(req('/api/agents/lea/rapport', { authorization: 'Bearer faux' }))).toThrow(/invalide/);
  });
  it('une clé par agent : Léa ne peut plus parler à la porte de Paul', () => {
    vi.stubEnv('QG_PASSE_AGENTS', 'passe'); vi.stubEnv('QG_CLE_AGENT_PAUL', 'cle-de-paul'); vi.stubEnv('QG_CLE_AGENT_LEA', 'cle-de-lea');
    const e = (cle?: string) => ({ 'x-vercel-protection-bypass': 'passe', ...(cle ? { 'x-qg-agent-cle': cle } : {}) });
    expect(() => verifierAgent(req('/api/agents/paul/rapport', e('cle-de-paul')))).not.toThrow();
    expect(() => verifierAgent(req('/api/agents/paul/rapport', e('cle-de-lea')))).toThrow(/cet agent/);
    expect(() => verifierAgent(req('/api/agents/paul/rapport', e()))).toThrow(/cet agent/);
    // une porte sans clé propre garde la preuve commune
    expect(() => verifierAgent(req('/api/agents/etat', e()))).not.toThrow();
  });
  it('agentDeLaRoute', () => {
    expect(agentDeLaRoute('https://qg.test/api/agents/Lea/rapport')).toBe('lea');
    expect(agentDeLaRoute('https://qg.test/api/etat')).toBeNull();
  });
});
