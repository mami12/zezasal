# Si të integrohet një lojë Slotopol me klientin dhe assetet origjinale

Ky udhëzues përshkruan mënyrën për të lidhur matematikën e Slotopol-it me një
faqe Node.js dhe me pamjen origjinale që sjell përdoruesi. Shembulli konkret është
Fortune Teller, me folderin `fortuntelle` dhe versionin `9.4.1-fortuneteller.238`.

Një AI tjetër mund ta kryejë këtë punë. I duhen burimet e plota, kërkesa të qarta,
mundësia për të punuar mbi projektin dhe një proces verifikimi. Emri i modelit
nuk e zëvendëson provën se loja, pamja dhe bilanci punojnë saktë.

## Çfarë u përdor në Fortune Teller

| Pjesa | Burimi dhe roli |
| --- | --- |
| Matematika | `slotopol/server`, folderi `game/slot/playngo/fortuneteller`, commit `20c55c7deeb9d147c1812763c8a0626c3a3d1e08` |
| Rrotullat | Të 13 grupet në YAML të Slotopol-it, të nxjerra në JSON |
| Rregullat | Pagesat, Wild/Cat, scatter, 15/20/25 free spins dhe Tarot nga kodi Go |
| Programi grafik | `fortuneteller_desktop.bundle.js`, nga folderi i dhënë |
| Ekrani dhe kontrollet | Përshkrimet origjinale në `config_desktop.json` dhe `ui_desktop_bundle.json` |
| Animacionet e lojës | `game_bundle.json`, `featurepreview_bundle.json` dhe motori origjinal |
| Figurat | Atlase PNG/JPG të simboleve, Tarot-it, logos, sfondit dhe ndërfaqes |
| Shkrimet dhe tingujt | Fontet, përkthimet dhe skedarët origjinalë të audios |
| Bilanci | Portofoli ekzistues i faqes dhe regjistri i transaksioneve PostgreSQL |
| Lidhja | Përshtatësi lokal që i kthen rezultatet e serverit në mesazhet e klientit origjinal |

Programi grafik origjinal përmban edhe kodin që shpërndan letrat, rrotullon rrotullat,
ndez simbolet fituese, drejton tingujt dhe ndryshon gjendjen e butonave. Këto nuk
merren duke kopjuar vetëm disa fotografi. Biblioteka e lojës dhe burimet e versionit
paketohen së bashku në `web/public/casino-original/fortune-teller/provider-original/`.

Versioni i parë kishte figura të marra nga folderi, por një panel dhe butona të
ndërtuar nga ne. Ai nuk plotësonte kërkesën për ndërfaqen origjinale. Hyrja e lojës
tani përdor programin origjinal; skedarët e atij paneli zëvendësues janë hequr.

## Rendi i rekomanduar i punës

1. **Përcakto rezultatin që kërkohet.** Shëno titullin dhe versionin e lojës,
   burimin e matematikës, folderin e klientit, monedhën, kufijtë e basteve dhe vendin
   ku hapet loja. Thuaj qartë nëse kërkohet pamja origjinale e plotë. Në këtë rast
   pranimi kërkon edhe butonat, sjelljen e tyre, animacionet dhe zërat origjinalë.

2. **Bëj inventarin e skedarëve përpara se të ndërtosh ndërfaqe.** Kontrollo nëse
   folderi përmban vetëm imazhe apo edhe programin e lojës, atlase, përshkrime
   animacionesh, fonte, audio, përkthime dhe nisës. Ndaji burimet e lojës nga faqja
   promovuese, regjistrimet e lidhjeve dhe sesionet e kapura. Në Fortune Teller
   versioni i lojës gjendet nën `cdn.playngonetwork.com/9.4.1-fortuneteller.238/`.

3. **Ngrije pamjen origjinale herët në një provë lokale.** Ngarko programin e
   ruajtur dhe burimet e tij me të dhëna prove, pa para reale. Kontrollo logon,
   ekranin hyrës, panelin dhe butonat. Kjo provë duhet bërë përpara se të harxhohet
   kohë për një panel të ri. Nëse mungon ndonjë skedar, identifikoje me emër dhe
   shpjego çfarë pengon. Mos e quaj kopje identike kur një animacion mungon.

4. **Fikso versionin e matematikës.** Ruaj commit-in e GitHub-it, skedarët e
   rregullave, rrotullat dhe licencën. Lexo rregullat dhe funksionet e përbashkëta
   që përdor loja. Emri i folderit, pamja ose emri tregtar nuk mjaftojnë për të
   përcaktuar variantin. Një lojë mund të përdorë linja, një tjetër 243 mënyra fitimi,
   dhe një tjetër mekanikë krejt tjetër bonusi.

5. **Shkruaj hartën e matematikës përpara përkthimit.** Për çdo simbol shëno ID-në,
   pagesat dhe rolin. Regjistro rendin e linjave, mënyrën e zgjedhjes së pozicionit
   në rrotull, trajtimin e Wild-it, scatter-it dhe bonusit. Për çdo pagesë përcakto
   njësinë: bast për linjë, bast total, monedha apo shumë parash. Regjistro edhe
   rregullat e rrotullimeve falas, riaktivizimet dhe rendin e zgjedhjeve.

6. **Vendos si do të ekzekutohet motori.** Mund të mbahet motori Go dhe Node.js
   të shërbejë si hyrje për faqen, ose matematika të portohet në Node.js. Portimi
   duhet të ruajë rrotullat, probabilitetet dhe pagesat. Në Fortune Teller u bë
   portim në JavaScript dhe zgjedhja e pozicioneve përdor `crypto.randomInt` në
   server. Programi grafik nuk përcakton fitimin financiar.

7. **Testo matematikën veçmas nga grafika.** Krahaso rezultate me pozicione të
   fiksuara të rrotullave dhe zgjedhje bonusi të njohura. Kur krahason Go me Node.js,
   përdor të njëjtat pozicione; e njëjta farë numerike nuk garanton të njëjtët numra
   në dy gjeneratorë të ndryshëm. Kontrollo rastet kufitare dhe kombinimet Wild.
   Për Tarot-in u kontrolluan të 64 treshet e mundshme dhe të 13 profilet e rrotullave.

8. **Verifiko RTP-në në njësinë dhe konfigurimin aktiv.** Kur është e mundur,
   llogarit probabilitetet ose numëro kombinimet. Simulimi me shumë rrotullime
   është kontroll shtesë me pasiguri statistikore; nuk provon vetë përputhje të
   saktë. Në Fortune Teller etiketa e profilit `94.735834` përputhet me një linjë.
   Me 20 linja, pagesa Tarot sipas bastit për linjë jep rreth `67.498263%`.
   Ky dallim duhet dokumentuar. Pagesat nuk duhen ndryshuar fshehurazi për të
   detyruar një përqindje të dëshiruar.

9. **Përputh ID-të e motorit me ID-të e klientit.** Mos supozo se simboli 1 i
   Slotopol-it është figura 1 e klientit. Fortune Teller përdor renditje të ndryshme:
   Wild 1 i motorit bëhet 9 në klient, Cat 2 bëhet 11 dhe Tarot 3 bëhet 10.
   Edhe letrat Tarot kanë renditje të kundërt për tabelën e pagesave. Një hartë e
   gabuar mund të shfaqë figurë ose theksim të gabuar edhe kur shuma është e saktë.

10. **Lidh klientin me portofolin përmes një përshtatësi.** Lexo çfarë mesazhesh
    dërgon dhe pret klienti origjinal. Serveri yt duhet t'i verifikojë dhe t'i kthejë
    në veprimet e motorit dhe të portofolit. Në këtë projekt klienti përdor mesazhe
    origjinale `d=...`, ndërsa përshtatësi ripërdor transaksionet ekzistuese të
    portofolit. Nuk përdoren sesionet e ruajtura të furnitorit.

11. **Ruaj një raund të pranuar vetëm një herë.** Verifiko lojtarin dhe bastin,
    regjistro debitimin dhe rezultatin së bashku, dhe përdor ID të kërkesës për
    riprovimet. Në Fortune Teller i gjithë zinxhiri i free spins dhe Tarot-i
    përcaktohen dhe ruhen me raundin e paguar. Shkëputja e lidhjes nuk duhet të
    krijojë rezultat tjetër, debit të dytë ose humbje të fitimit. Rihapja dhe
    mbyllja duhet ta arkëtojnë një fitim të pranuar vetëm një herë.

12. **Përshtat vlerat e kontrolleve origjinale me kufijtë e faqes.** Mbaj panelin
    dhe butonat origjinalë, por jepu monedhën dhe vlerat e lejuara nga portofoli.
    Kontrollo Coins, Coin Value, Lines, Min/Max, Spin, ndalimin e shpejtë,
    autoplay, tingullin dhe tabelën e pagesave. Në këtë integrim kufiri mbetet
    20–5000 ALL për bastin total; linjat dhe monedhat nuk duhet ta anashkalojnë.

13. **Testo pamjen gjatë veprimit.** Mos u mjafto me një fotografi të ekranit
    fillestar. Shiko nisjen, lëvizjen dhe ndalimin e rrotullave; figurat e rezultatit;
    vijat dhe simbolet fituese; numërimin e fitimit; hyrjen dhe daljen nga bonusi;
    kthimin e letrave dhe free spins. Provo kompjuterin dhe telefonin në të dy
    orientimet. Kontrollo edhe ngarkimet që dështojnë dhe gabimet e JavaScript-it.
    Provoje brenda kornizës reale të faqes: hape lojën kur faqja është tashmë në
    fullscreen, hape autoplay-n, ndrysho madhësinë dhe dil/hyr përsëri në fullscreen.
    Paneli dhe butoni i mbylljes duhet të mbeten të dukshëm në mes; pas mbylljes
    provo butonat origjinalë me klikime reale. Kontrollo figurën e vizatuar, sepse
    përmasat e sakta të elementeve mund të bashkëjetojnë me një pamje të zezë.
    Për Fortune Teller kjo mbulohet nga `npm run test:fortune-teller-layout`,
    edhe me shkallë ekrani 200% dhe dritare reale të shfletuesit.

14. **Testo prishjet dhe financat.** Provo klikime të përsëritura, përgjigje të
    humbura, rifreskim gjatë bonusit, mbyllje, rihapje dhe rinisje të serverit.
    Krahaso bilancin me regjistrin e transaksioneve. Testet duhet të përdorin
    llogari dhe bazë prove; kontrollo edhe hyrjen pa sesion dhe kërkesat nga një
    faqe tjetër. Fitimet e pranuara duhet të mbeten të pandryshuara pas ndryshimit
    të profilit për bastet e ardhshme.

15. **Ndërto dhe dorëzo versionin e verifikuar.** Paketimi duhet të përfshijë
    programin grafik dhe të gjitha varësitë lokale që përdor ai. Regjistro burimin
    dhe ndryshimet e domosdoshme. Dorëzo komandat e provës, pamjet e kontrolluara,
    rrugën e lojës dhe kufizimet reale. Thuaj qartë nëse u përditësua vetëm kodi
    lokal apo edhe serveri që po shërben faqen.

## Çfarë kërkoi kujdes në këtë klient

- Kopja e ruajtur kishte operatorë JavaScript të ndarë si `? ?` dhe `? .`.
  U riparua sintaksa në kopjen e paketuar; folderi burimor ruhet.
- Atlase dhe përshkrime animacionesh punojnë së bashku. Motori origjinal trajton
  prerjet, shkallën, shtresat dhe kohëzgjatjen; fotografitë individuale nuk e bëjnë këtë.
- Tarot-i origjinal ka tri faza me katër letra në secilën fazë. Mesazhi që mbyll
  spin-in duhet të vijë pas konfirmimit të zgjedhjes së tretë, sipas leximit që bën klienti.
- Konfirmimi i rrotullimit të fundit falas nuk duhet trajtuar si një bast i ri.
- Diçitura e shumëzuesve Tarot u përshtat në `X LINE BET` që të përputhet me
  matematikën Slotopol. Figurat dhe animacionet origjinale përdoren të pandryshuara.
- Ndryshimet e vlerave të lejuara të bastit duhet të respektojnë njoftimet e
  panelit origjinal; ndërhyrja në mes të një njoftimi mund të lërë një buton në gjendje të gabuar.

## Skedarët kryesorë për një AI që vazhdon projektin

| Skedari | Puna që kryen |
| --- | --- |
| `server/casino/fortune-teller-engine.mjs` | Matematika dhe raundi i plotë |
| `server/casino/fortune-teller-data.json` | Rrotullat dhe kthimet teorike |
| `server/casino/fortune-teller-return.mjs` | Llogaritja e probabiliteteve |
| `server/casino/fortune-teller-protocol.mjs` | Përshtatja me protokollin e portofolit |
| `server/casino/fortune-teller-native.mjs` | Mesazhet dhe ID-të e klientit origjinal |
| `server/casino/original-wallet-store.mjs` | Transaksionet, ruajtja, riprovimet dhe arkëtimi |
| `server/casino/original-wallet.mjs` | Sesioni i mbrojtur dhe rrugët e lojës |
| `web/public/casino-original/fortune-teller/native-wallet.js` | Nisja e klientit origjinal dhe lidhja me faqen |
| `scripts/sync-fortune-teller-native.mjs` | Paketimi i burimeve origjinale dhe regjistri i ndryshimeve |
| `scripts/test-fortune-teller*.mjs` | Testet e matematikës, portofolit, mesazheve dhe pamjes |

Për një lojë tjetër Slotopol ripërdor strukturën e portofolit dhe të testeve.
Analizo veçmas rregullat, ID-të dhe mesazhet e atij klienti. Përshtatësi Fortune
Teller nuk është automatikisht i saktë për çdo titull tjetër.

## Kërkesë e gatshme për një AI tjetër

> Integro lojën [EMRI] në projektin [SHTEGU], me matematikën nga [URL DHE COMMIT
> SLOTOPOL] dhe klientin origjinal nga [FOLDERI]. Dua programin grafik, imazhet,
> animacionet, butonat, fontet dhe tingujt origjinalë. Fillimisht bëj inventarin
> dhe provo që klienti origjinal ngarkohet lokalisht. Pastaj analizo matematikën,
> njësitë e pagesave, rrotullat dhe bonuset; portoje ose ekzekutoje pa ndryshuar
> probabilitetet. Lidhe me portofolin ekzistues përmes një përshtatësi të mesazheve.
> Mbaj autentikimin, kufijtë dhe transaksionet atomike. Kërkesat e përsëritura
> duhet të kthejnë të njëjtin rezultat. Testo matematikën me raste të njohura dhe
> testo vizualisht spin-in, çdo kontroll, bonuset dhe telefonin. Mos krijo figura,
> animacione apo panel zëvendësues për pjesë që ndodhen në folder. Nëse mungon
> diçka, identifikoje qartë. Dorëzo versionin që kalon testet, pamjet e provës,
> listën e skedarëve të ndryshuar dhe çdo kufizim real.

## Codex, modeli dhe një chat tjetër

Modeli është pjesa që arsyeton dhe shkruan kod. Mjedisi i punës i jep qasje në
skedarë, mjete ekzekutimi dhe prova. Në këtë sesion u lexua folderi lokal, u ndryshuan
skedarë, u ekzekutuan teste dhe u kontrolluan pamjet e shfletuesit.

Dokumentacioni i OpenAI për [Codex në editor](https://learn.chatgpt.com/docs/codex/ide)
përshkruan punën mbi kodin dhe ndryshimet në projekt. Dokumentacioni për
[GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) e paraqet
si model për programim kompleks dhe përdorim kompjuteri. Kjo nuk provon që një
model tjetër nuk mund ta ndërtojë lojën.

Një chat pa qasje në projekt mund të japë kod, por nuk mund ta ekzekutojë vetë
në kompjuterin tënd. Një AI tjetër me mjete dhe burime të ngjashme mund të bëjë
të njëjtën punë. Rezultati duhet gjykuar nga përputhja me burimin, provat dhe
sjellja e verifikuar e lojës; gabimet dhe përmirësimet duhen raportuar hapur.
