import { describe, it, expect } from 'vitest';
import { aiguiller } from './routage';
import type { Recu } from '../telegram';

const txt = (texte: string): Recu => ({ type: 'texte', id: 'm1', de: '1', texte });
const btn = (donnee: string): Recu => ({ type: 'bouton', id: 'c1', de: '1', donnee, chat: 1, message: 2 });

describe('aiguiller', () => {
  it('1. boutons ok / non', () => {
    expect(aiguiller(btn('ok:ab12'))).toEqual({ vers: 'accord', texte: '#ab12 OK' });
    expect(aiguiller(btn('non:ab12'))).toEqual({ vers: 'accord', texte: '#ab12 non' });
  });
  it('2. bouton sujet', () => {
    expect(aiguiller(btn('sujet:p1x2:2'))).toEqual({ vers: 'sujet', propositionId: 'p1x2', index: 2 });
  });
  it('bouton vu-light', () => {
    expect(aiguiller(btn('vu-light:2026-11-09'))).toEqual({ vers: 'vu-light', jour: '2026-11-09' });
    expect(aiguiller(btn('vu-light:'))).toEqual({ vers: 'rien' });
  });
  it('3. bouton publie', () => {
    expect(aiguiller(btn('publie:zz99'))).toEqual({ vers: 'publie', postId: 'zz99' });
  });
  it('3 bis. boutons publier / republier', () => {
    expect(aiguiller(btn('publier:abc'))).toEqual({ vers: 'publier', postId: 'abc', forcer: false });
    expect(aiguiller(btn('republier:abc'))).toEqual({ vers: 'publier', postId: 'abc', forcer: true });
    expect(aiguiller(btn('publier:'))).toEqual({ vers: 'rien' });
  });
  it('4. /start', () => {
    expect(aiguiller(txt('/start'))).toEqual({ vers: 'start' });
  });
  it('5. réponse d’accord courte', () => {
    expect(aiguiller(txt('#ab12 modifie : plus court'))).toEqual({ vers: 'accord', texte: '#ab12 modifie : plus court' });
    expect(aiguiller(txt('ok'))).toEqual({ vers: 'accord', texte: 'ok' });
  });
  it('5. « ok mais change l’accroche » n’est pas un accord : un message libre, pour Kuroro', () => {
    expect(aiguiller(txt('ok mais change l’accroche'))).toEqual({ vers: 'kuroro', texte: 'ok mais change l’accroche' });
  });
  it('5. réponse d’accord trop longue : pas un accord', () => {
    const long = 'modifie : ' + 'a'.repeat(400);
    expect(aiguiller(txt(long)).vers).toBe('kuroro');
  });
  it('6. lien', () => {
    expect(aiguiller(txt('https://example.com/x super article'))).toEqual({ vers: 'boite', type: 'lien', contenu: 'https://example.com/x super article' });
  });
  it('7. commentaire', () => {
    expect(aiguiller(txt('commentaire : très bon point'))).toEqual({ vers: 'boite', type: 'commentaire', contenu: 'très bon point' });
    expect(aiguiller(txt('com : bravo'))).toEqual({ vers: 'boite', type: 'commentaire', contenu: 'bravo' });
  });
  it('8. note pour L : « note : », « idée : », « pour L : » ; sans préfixe, un message pour Kuroro', () => {
    expect(aiguiller(txt('note : une idée de post'))).toEqual({ vers: 'boite', type: 'note', contenu: 'une idée de post' });
    expect(aiguiller(txt('Idée : parler du QG'))).toEqual({ vers: 'boite', type: 'note', contenu: 'parler du QG' });
    expect(aiguiller(txt('pour L : plus court'))).toEqual({ vers: 'boite', type: 'note', contenu: 'plus court' });
    expect(aiguiller(txt('une idée de post'))).toEqual({ vers: 'kuroro', texte: 'une idée de post' });
    expect(aiguiller(txt('note :'))).toEqual({ vers: 'kuroro', texte: 'note :' });
  });
  it('9. fichier', () => {
    expect(aiguiller({ type: 'fichier', id: 'm2', de: '1', fileId: 'F1', nom: 'a.pdf' })).toEqual({ vers: 'boite', type: 'fichier', contenu: 'F1|a.pdf' });
  });
  it('boutons « Ignorer », « Reprendre », durée de pause', () => {
    expect(aiguiller(btn('ign:site:api-livreo'))).toEqual({ vers: 'silence', donnee: 'ign:site:api-livreo' });
    expect(aiguiller(btn('rep:zoro@qg'))).toEqual({ vers: 'silence', donnee: 'rep:zoro@qg' });
    expect(aiguiller(btn('pse:120'))).toEqual({ vers: 'silence', donnee: 'pse:120' });
    expect(aiguiller(btn('ign:'))).toEqual({ vers: 'rien' });
  });
  it('10. rien', () => {
    expect(aiguiller(txt('   '))).toEqual({ vers: 'rien' });
    expect(aiguiller(btn('inconnu:1'))).toEqual({ vers: 'rien' });
  });
  it('« Commentaires reçus hier » est une note, pas un commentaire', () => {
    expect(aiguiller(txt('Commentaires reçus hier'))).toEqual({ vers: 'kuroro', texte: 'Commentaires reçus hier' });
    expect(aiguiller(txt('Commentaire : super post'))).toEqual({ vers: 'boite', type: 'commentaire', contenu: 'super post' });
  });
  it('boutons de Clara', () => {
    expect(aiguiller(btn('cl1:ab12cd34:o'))).toEqual({ vers: 'clara', donnee: 'cl1:ab12cd34:o' });
    expect(aiguiller(btn('cl2:ab12cd34:n'))).toEqual({ vers: 'clara', donnee: 'cl2:ab12cd34:n' });
    expect(aiguiller(btn('cld:ab12cd34'))).toEqual({ vers: 'clara', donnee: 'cld:ab12cd34' });
    expect(aiguiller(btn('cl1:'))).toEqual({ vers: 'rien' });
  });
  it('Isaac : isc:o:<id> / isc:n:<id> (id avec « : »)', () => {
    expect(aiguiller(btn('isc:o:cache:cursor'))).toEqual({ vers: 'isaac', id: 'cache:cursor', oui: true });
    expect(aiguiller(btn('isc:n:nm:qg'))).toEqual({ vers: 'isaac', id: 'nm:qg', oui: false });
    expect(aiguiller(btn('isc:o:'))).toEqual({ vers: 'rien' });
    expect(aiguiller(btn('isc:x:a'))).toEqual({ vers: 'rien' });
  });
  it('Ye : ye:v|r|o|n:<id>', () => {
    expect(aiguiller(btn('ye:v:abcdef0123'))).toEqual({ vers: 'ye', id: 'abcdef0123', quoi: 'v' });
    expect(aiguiller(btn('ye:n:abcdef0124'))).toEqual({ vers: 'ye', id: 'abcdef0124', quoi: 'n' });
    // projet absent du portfolio : Ajouter, Pas maintenant, Jamais
    expect(aiguiller(btn('ye:a:abcdef0125'))).toEqual({ vers: 'ye', id: 'abcdef0125', quoi: 'a' });
    expect(aiguiller(btn('ye:p:abcdef0125'))).toEqual({ vers: 'ye', id: 'abcdef0125', quoi: 'p' });
    expect(aiguiller(btn('ye:j:abcdef0125'))).toEqual({ vers: 'ye', id: 'abcdef0125', quoi: 'j' });
    expect(aiguiller(btn('ye:x:abcdef0123'))).toEqual({ vers: 'rien' });
    expect(aiguiller(btn('ye:v:'))).toEqual({ vers: 'rien' });
  });
  it('Paul : pau:v:<id> / pau:r:<id>', () => {
    expect(aiguiller(btn('pau:v:abcdef0123'))).toEqual({ vers: 'paul', id: 'abcdef0123', valider: true });
    expect(aiguiller(btn('pau:r:abcdef0123'))).toEqual({ vers: 'paul', id: 'abcdef0123', valider: false });
    expect(aiguiller(btn('pau:v:'))).toEqual({ vers: 'rien' });
    expect(aiguiller(btn('pau:x:abcdef0123'))).toEqual({ vers: 'rien' });
    expect(aiguiller(btn('pau:v:a:b'))).toEqual({ vers: 'rien' });
  });
  it('« VIP : … » / « plus VIP : … », avant la note pour L, sans casse', () => {
    expect(aiguiller(txt('VIP : @Banque.ci'))).toEqual({ vers: 'clara-vip', ajout: true, entree: '@banque.ci' });
    expect(aiguiller(txt('vip: Paul <Paul@Ami.com>'))).toEqual({ vers: 'clara-vip', ajout: true, entree: 'paul@ami.com' });
    expect(aiguiller(txt('Plus VIP : paul@ami.com'))).toEqual({ vers: 'clara-vip', ajout: false, entree: 'paul@ami.com' });
    expect(aiguiller(txt('VIP : penser à Paul'))).toEqual({ vers: 'clara-vip', ajout: true, entree: null });
    expect(aiguiller(txt('VIP :'))).toEqual({ vers: 'clara-vip', ajout: true, entree: null });
    expect(aiguiller(txt('mes VIP : à revoir')).vers).toBe('kuroro');
    expect(aiguiller(txt('VIP : @suu.edu\nVIP : proche@exemple.com'))).toEqual({ vers: 'clara-vips', lignes: [
      { ajout: true, entree: '@suu.edu' }, { ajout: true, entree: 'proche@exemple.com' }] });
  });
});
