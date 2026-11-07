# Sizzling Hot Deluxe: integrim me faqen sportive

## Faqja e kazinosë
Ka vetëm **Sizzling Hot Deluxe**. Rrugët `/casino` dhe `/casino/sizzling` shfaqin klientin origjinal Pixi/Spine/Howler të kopjuar gjatë build-it nga `mami12/New-folder`, commit-i i fiksuar në `scripts/sync-original-sizzling.mjs`. Grafikat, animacionet, logoja, audio dhe kontrolli origjinal i basteve/5 linjave mbeten pjesë e lojës. Nuk shfaqen tetë lojërat e tjera apo motorë me emoji.

- `/app/casino-original/sizzling/index.html`: adresa e vjetër ridrejton në `/app/casino/sizzling`. API e demo-s nuk ekspozohet në serverin e faqes sportive. Demo e izoluar mbahet vetëm në testet automatike.
- `/app/casino-original/sizzling/index-real.html`: klienti i vetëm aktiv vizual për lojtarët, me API `/app/api/casino/sizzlinghotdeluxe/real/play`, që dërgon spin te portofoli i përbashkët PostgreSQL. Për real-money `gamble/double` është i çaktivizuar.
- Fullscreen në desktop dhe mobile kërkon `screen.orientation.lock('landscape')` ku mbështetet, dhe CSS fallback për iOS e browser-a të kufizuar. Rrotullimi fizik nuk garantohet në çdo pajisje.

## Portofoli dhe financat
Bilanci i sportit/kazinosë është `app_user.balance`. Çdo spin ruhet me UUID unik për shmangien e debitimeve të dyfishta, rezultatin e motorit në server, bastin, pagesën, profilin matematikor, bilancin pas raundit dhe referencat në `app_transaction`. Fitimi/humbja e menaxherit për lojtarët e vet regjistrohet në të njëjtin transaksion të databazës.

Paneli admin/menaxher shfaq sportin dhe kazinonë të ndara, bilancin, fitime/humbjet dhe transaksionet e secilit përdorues, me filtrat e datës. Historiku i raundeve Sizzling tregon bastin, fitimin dhe bilancin pas secilit spin. Nuk fshihet llogari që ka histori financiare.

## RTP
Paneli admin shfaq RTP teorike të llogaritur nga tabela e pagesave dhe probabilitetet e reel stop-eve si dhe RTP të vëzhguar nga raundet. Profilet matematike të këtij adapteri janë të përhershme/versionuara, globale dhe me audit. Nuk lejohet ndryshim profili gjatë lojës aktive apo individualisht për lojtarin.

**Matematika e adapterit nuk është matematika e certifikuar e prodhuesit Novomatic.** Në faqen publike nuk përdoret më asnjë portofol demo. Kur modaliteti monetar është OFF, loja tregon mesazh çaktivizimi dhe nuk bën kalim te demo. Pas përditësimit të skemës së databazës, porta e Sizzling aktivizohet një herë për portofolin e sportit. Administratori mund ta çaktivizojë ose riaktivizojë pa ndryshuar environment variables. Motori mbetet adapter jo i certifikuar; për përdorimin komercial duhen autorizimet, të drejtat dhe verifikimet përkatëse.

## Testet
- `node scripts/test-sizzling-demo.mjs`: protokolli/linjat dhe fitimet e demo-s.
- `node scripts/test-casino-math.mjs`: probabilitetet e Sizzling dhe profilet RTP.
- `node scripts/test-casino-art.mjs`: vetëm Sizzling dhe asetet e tij.
- `node scripts/verify-original-sizzling.mjs`: sigurohet se klienti, image atlases, animacionet dhe audio janë në build.
- `node scripts/test-sizzling-browser.mjs`: Pixi ngarkohet dhe dërgon init/spin nga canvas.
- `node scripts/test-casino-ledger.mjs`: PostgreSQL i përkohshëm në CI, idempotenca, bilanci i lojtarit e menaxherit dhe kufizimet.

## Integrimi i vetëm me bilancin sportiv

Në `/casino` dhe `/casino/sizzling`, React kërkon `GET /app/api/casino/status` dhe pastaj `POST /app/api/casino/session`. Nëse aktivizimi është i pamundur, shfaqet një mesazh dhe **nuk ngarkohet demo**. Klienti origjinal Pixi përdor vetëm endpoint-in e autentikuar `/app/api/casino/sizzlinghotdeluxe/real/play`. Serveri lexon bilancin nga `app_user.balance`, të njëjtën fushë që lexon `/app/api/auth/me` për sportin. Për çdo spin, bën lëvizjet e bastit dhe të fitimit në `app_transaction` dhe rifreskon `app_user.balance`. Sporti dhe kazinoja nuk kanë portofola apo depozita të ndara.

Deploy i commit-it të ri zbaton një migrim vetëm një herë që aktivizon hyrjen e portofolit të përbashkët dhe heq varësinë nga `CASINO_REAL_MONEY_ENABLED` dhe `CASINO_MATH_APPROVED`. Pas migrimit, zgjedhja e administratorit (Aktivizo/Çaktivizo) ruhet në PostgreSQL në çdo restart. **Ky ndryshim teknik nuk dëshmon certifikim, licencë ose të drejtë përdorimi të motorit Novomatic.**


## Zgjidhja e mesazhit 'Operatori nuk e ka aktivizuar ende'

Në versionin e kaluar tri porta bllokonin hyrjen: dy environment variables dhe `app_casino_settings.enabled=false`. Versioni i ri përdor vetëm autorizimin e lojtarit dhe gjendjen e administrimit në databazë. Migrimi `wallet_rollout_applied` e aktivizon një herë, pa modifikuar `app_user.balance` apo transaksionet. Nëse administratori e çaktivizon më vonë, një restart nuk e riaktivizon. Kontrolloni `/health` në Railway dhe identifikohuni si lojtar (rol PLAYER, status ACTIVE) për të testuar klientin Pixi. Deployment automatik kërkon që Railway të jetë lidhur me branch `main` dhe të ketë `DATABASE_URL` funksionale.
