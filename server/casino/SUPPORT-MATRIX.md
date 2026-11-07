# Parametrat e mbështetur të kazinove

Ky dokument mbulon kërkesat e mbrojtura 7 dhe 12. RTP është pritshmëri afatgjatë
e pagesës ndaj bastit. Hit Frequency është përqindja e raundeve të paguara që
paguajnë një shumë pozitive, përfshirë të gjithë bonusin; nuk është përqindja e
raundeve me fitim neto. Asetet, tingujt, simbolet, animacionet dhe kontrollet e
lojës origjinale nuk ndryshojnë kur zgjidhet profili matematikor.

## Mbulimi për çdo lojë

| Loja | Profile origjinale | Intervali origjinal i RTP | RTP/HF të personalizuara |
| --- | ---: | ---: | --- |
| Lucky Clover X3 | 22 | 90.004959–107.003880% | Po, me kontrollin e realizueshmërisë |
| Viking’s Fun | 23 | 86.643973–110.438922% | Po, me kontrollin e realizueshmërisë |
| Fruit Queen | 13 | 90.033138–109.778955% | Po, me kontrollin e realizueshmërisë |
| Seven Hot | 9 | 94.614174–105.474371% | Po, me kontrollin e realizueshmërisë |
| Sizzling Hot Deluxe | 4 | 82.900480–95.660402% | Po, me kontrollin e realizueshmërisë |
| Book of Ra Deluxe | 8 | 52.159400–95.089721% pa free spins | Po; modeli varet edhe nga free spins |
| Fire Joker | 8 | 81.235340–103.562730% | Ende jo; vetëm profilet origjinale të ofruara |
| Fortune Teller | 13 | 61.824444–88.493505% me 20 linja | Ende jo; vetëm profilet origjinale të ofruara |

Intervalet përfaqësojnë profile diskrete, jo çdo numër midis skajeve.
Book me free spins përdor pritshmërinë që përfshin dhjetë rrotullimet e bonusit;
profili i tij origjinal jep rreth 108.716872%. Fortune Teller përdor RTP efektive
me numrin aktiv të linjave: etiketa Slotopol e strips-ave është kalibruar me një
linjë dhe nuk është RTP e lojës me 20 linja. Vlera parazgjedhje me 20 linja është
67.4982627559%. Këto dallime mbeten të dukshme në raportimin e motorit.

## Çfarë zbatohet realisht në Custom

Gjashtë lojërat e shënuara pranojnë RTP deri në 1000% dhe HF deri në 100%, me dy
shifra pas presjes. Parametrat vlejnë globalisht për raundet e ardhshme. Vlerat
zero mbështeten vetëm si çift RTP=0 dhe HF=0, për të ruajtur modelin ekzistues.

Çifti R/H duhet të jetë brenda shumëzuesve që tabela e pagesave mund të paguajë.
Kufijtë konservatorë mbulojnë të gjitha bastet dhe linjat e lejuara:

| Loja | Pagesa mesatare minimale e një raundi pozitiv / basti | Maksimumi |
| --- | ---: | ---: |
| Lucky Clover X3 | 2 | 390 |
| Viking’s Fun | 0.225 | 123.95 |
| Fruit Queen | 5 | 200 |
| Seven Hot | 2 | 170 |
| Sizzling Hot Deluxe | 0.425 | 100 |
| Book of Ra Deluxe, free spins OFF | 0.225 | 1002.425 |

Prandaj, 10%/1%, 50%/5% dhe 100%/20% janë shembuj të realizueshëm në të gjashta.
200%/50% nuk realizohet nga katalogu global i Fruit Queen: R/H=4, ndërsa minimumi
i saj është 5. Kërkesa refuzohet përpara ruajtjes dhe përpara bastit. Çifti
1000%/100% realizohet në të gjashta dhe kontrollohet edhe nga testi HTTP i adminit.
Për Book me free spins ON motori llogarit kufijtë nga katalogu i veçantë i atij
varianti; vlerat OFF nuk përdoren si garanci për variantin ON.

HF 1000% nuk është një probabilitet. Motori nuk e ruan si përqindje funksionale,
nuk e shkurton fshehurazi në 100% dhe nuk ofron një shumëzues frekuence fiktiv.
Një parametër tjetër frekuence kërkon model matematikor të përcaktuar dhe prova
të veçanta. Fire Joker dhe Fortune Teller nuk deklarohen se mbështesin Custom
pa u implementuar dhe verifikuar modeli i tyre përkatës.

Pagesat e çdo trajektoreje vlerësohen nga tabela origjinale. Peshat e sakta
racionale vendosin njëkohësisht RTP dhe HF; nuk shkallëzohen pagesat e një fitoreje
dhe nuk përdoren bilanci apo identiteti i lojtarit për të zgjedhur rezultatin.
Bonuset dhe përgjigjet e pranuara më parë mbajnë kushtet e ngrira të raundit.

## Kontrolli

- `node scripts/test-custom-casino-math.mjs`: pesha racionale, RTP/HF ekzakte,
  çdo bast/linjë e mbuluar, tabela pagesash, bonuset dhe kufijtë.
- `node scripts/test-casino-rtp-extended.mjs`: endpoint-i real i adminit, 600/100
  dhe 1000/100 për gjashtë lojëra, role, refuzim atomik i çifteve të pamundura.
- `node scripts/test-original-wallet-profiles.mjs`: tetë lojërat, ndryshimet
  globale, kërkesat e përsëritura, bonuset e ngrira dhe përputhja e regjistrit.
- `node scripts/test-casino-protected-simulation.mjs`: simulime diagnostike
  me motorët realë dhe raport statistikor të riprodhueshëm.
- `node scripts/verify-fortune-teller-assets.mjs` dhe verifikuesit e tjerë të
  aseteve: skedarët origjinalë, kontrollet dhe varësitë grafike të paketuara.

Simulimet janë diagnostike dhe nuk janë certifikim i pavarur. Një mostër nuk
garanton kthim të caktuar për lojtarin; pranimi kontrollohet ndaj gabimit standard
të mostrës dhe testeve të veçanta ekzakte të motorit.
