// TikTok-Press : pont entre les cadeaux TikTok LIVE et la presse.
// Configuration : variable d'environnement TIKTOK_USER (votre @pseudo, sans le @).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';

const USER = (process.env.TIKTOK_USER || '').replace(/^@/, '');
const PORT = process.env.PORT || 3000;
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const clients = new Set();

function diffuser(ev) {
  const ligne = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(ligne);
  console.log('Ticket ->', ev.pseudo, ev.cadeau, 'x' + ev.quantite);
}

// Correspondance cadeau TikTok -> type de ticket (adaptez ici si besoin)
function typeCadeau(nom = '') {
  const n = nom.toLowerCase();
  if (n.includes('donut')) return 'donut';
  if (n.includes('rose')) return 'rose';
  if (n.includes('heart me') || n.includes('cœur') || n.includes('coeur')) return 'coeur';
  return null;
}

// --- Serveur web : la presse + le flux d'événements ---
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    const bat = setInterval(() => res.write(': ok\n\n'), 20000);
    req.on('close', () => { clearInterval(bat); clients.delete(res); });
    return;
  }
  if (url.pathname === '/test') { // ex. /test?cadeau=donut&pseudo=@moi&quantite=3
    diffuser({ pseudo: url.searchParams.get('pseudo') || '@test', cadeau: url.searchParams.get('cadeau') || 'rose', quantite: +(url.searchParams.get('quantite') || 1) });
    res.end('ok');
    return;
  }
  fs.readFile(path.join(DIR, 'index.html'), (e, buf) => {
    res.writeHead(e ? 500 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(e ? 'Erreur' : buf);
  });
}).listen(PORT, () => console.log('Presse prête sur le port', PORT));

// --- Connexion TikTok ---
const serie = new Map(); // suivi des séries de cadeaux (ex. 10 roses d'affilée)

function avatarDe(u = {}) {
  return u.profilePictureUrl || u.profilePicture?.url?.[0] || u.avatarThumb?.urlList?.[0] || u.avatarThumb?.url?.[0] || '';
}

async function lancer() {
  if (!USER) { console.log('Définissez TIKTOK_USER (votre pseudo TikTok).'); return; }
  const conn = new TikTokLiveConnection(USER, { enableExtendedGiftInfo: true });

  conn.on(WebcastEvent.GIFT, (d) => {
    const nom = d.giftDetails?.giftName || d.extendedGiftInfo?.name || d.giftName || '';
    const cadeau = typeCadeau(nom);
    if (!cadeau) { console.log('Cadeau ignoré :', nom || d.giftId); return; }
    const u = d.user || d;
    const pseudo = '@' + (u.uniqueId || u.nickname || 'spectateur');
    const cle = `${u.userId || u.uniqueId}:${d.giftId}`;
    const total = d.repeatCount || 1;
    const enSerie = (d.giftType === 1 || d.giftDetails?.giftType === 1);
    let quantite = total;
    if (enSerie) { // n'imprimer que les nouveaux cadeaux de la série
      let deja = serie.get(cle) || 0;
      if (total < deja) deja = 0;
      quantite = total - deja;
      if (d.repeatEnd) serie.delete(cle); else serie.set(cle, total);
      if (quantite <= 0) return;
    }
    diffuser({ eventId: `${cle}:${total}:${d.msgId || ''}`, pseudo, avatar: avatarDe(u), cadeau, quantite });
  });

  const reconnecter = () => { console.log('Reconnexion dans 15 s…'); setTimeout(lancer, 15000); };
  conn.on(WebcastEvent.DISCONNECTED, reconnecter);
  conn.on(WebcastEvent.ERROR, (e) => console.error('Erreur TikTok :', e?.message || e));
  try { await conn.connect(); console.log('Connecté au direct de @' + USER); }
  catch (e) { console.log('Connexion impossible (êtes-vous en direct ?) :', e?.message || e); reconnecter(); }
}
lancer();
