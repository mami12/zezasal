# Kopja e plotë private për Windows

Kjo kopje përfshin kodin, asetet origjinale, konfigurimin privat dhe databazën e
laptopit me 14 llogari. Databaza është kontrolluar tabelë për tabelë, përfshirë
kredencialet, bilancet dhe historikun. Nuk kërkon import manual të databazës.

1. Ndal kopjen e vjetër të serverit me `stop.bat`.
2. Nxirre ZIP-in në **një folder të ri**, që të mos përzihen dy databaza.
3. Hape `start.bat` brenda atij folderi. Mos ndrysho `.env` dhe mos hap
   `restore-db.bat`. Paketat e nevojshme instalohen automatikisht herën e parë;
   kërkohet Node.js dhe internet. Përdoruesit dhe çelësat janë tashmë aty.

Live dhe parandeshjet shfaqin të gjitha ndeshjet reale që sjell API-ja, pa kufi lige, date të parazgjedhur ose koeficientësh. Vetëm admini mund t’i fshehë: Admin → Ndeshjet dhe kuotat → Fshih ndeshjen / Shfaq ndeshjen.

Paneli i ri: **Admin → Bastet dhe verifikimi**. Champions, Europa, Conference dhe
World Cup janë ruajtur. Telegram-i është lënë për më vonë me kërkesë të përdoruesit.

Kjo paketë dhe repository përmbajnë të dhëna private. Mos e bëj repository-n publik
dhe mos e shpërnda ZIP-in. Pas nisjes në server, ruaj databazën aktive të serverit
gjatë përditësimeve të ardhshme; snapshot-i i laptopit nuk përmban aktivitet të ri
që mund të kryhet më pas në server.

Administratori mund të zgjedhë numrin e parandeshjeve te Lista e ndeshjeve: 0 = të gjitha; p.sh. 100 = deri në 100. Shtyp Ruaj. Ky kufi nuk fshin ndeshjet ose historikun dhe nuk kufizon live.
