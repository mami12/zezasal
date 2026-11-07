# Zerimi financiar dhe minimumi i kazinosë

## Butoni në admin

Hap **Admin → Raportet → Zerimi financiar**. Përmbledhja tregon llogaritë me bilanc, shumën totale dhe numrin e biletave. Butoni hap konfirmimin; kërkon kodin **1122** dhe fjalën **RESET**. Kodi kontrollohet në server dhe veprimi lejohet vetëm për administratorin aktiv.

Fshihen biletat dhe kolonat, transaksionet, refuzimet e basteve, transfertat e mëparshme, raundet/bonusët/fitimet e patërhequra të kazinosë dhe regjistri i vjetër i veprimeve. Të gjithë përdoruesit, përfshirë menaxherët, agjentët dhe adminët, marrin bilanc **0**. Ruhet një regjistrim i zerimit.

Ruhen llogaritë, fjalëkalimet, rolet, lidhjet mes përdoruesve, gjendjet e llogarive, kufijtë dhe vetëpërjashtimet, cilësimet e faqes dhe rezultatet/statistikat e konfirmuara të ndeshjeve. Ky është zerim i të dhënave financiare, jo fshirje e përdoruesve ose e konfigurimit.

Para fshirjes krijohet një backup i plotë lokal `backups/before-financial-reset-....tgz`, jashtë folderëve të shërbyer publikisht. Nëse backup-i dështon ose ndonjë ndryshim SQL dështon, të dhënat mbeten siç ishin. Backup-i përmban të dhëna private dhe nuk duhet shpërndarë ose ngarkuar në GitHub.

Operacioni mban databazën të zënë gjatë backup-it dhe transaksionit. Sesionet e mëparshme të hyrjes dhe të lojërave bëhen të pavlefshme, duke bllokuar kërkesat e vjetra. Adminit që përfundon veprimin i jepet një sesion i ri; klientët e tjerë duhet të identifikohen përsëri. Kërkesa e njëjtë nuk kryhet dy herë, edhe nëse humbet përgjigjja ose rifreskohet faqja.

**Zerimi nuk u ekzekutua në databazën tënde gjatë instalimit.** Provat u bënë vetëm me databaza të përkohshme dhe u testua rikthimi i backup-it.

## Minimumi i kazinosë

Basti total i një rrotullimi me pagesë është **20–5000 Lek**, për të gjashta lojërat e integruara. Minimumi vlen për shumën totale, jo për secilën linjë. Menuja origjinale dhe basti fillestar përputhen me këtë kufi. Serveri refuzon një bast të ri nën 20 edhe nëse dërgohet jashtë menusë.

Riluajtja e një kërkese historike të pranuar më parë dhe free spins të fituara më parë ruajnë kushtet origjinale; nuk tarifohen sërish ose rriten në 20. Njësitë e kreditit/denominacionet origjinale mund të jenë ende nën 20, ndërsa basti total me pagesë fillon nga 20.

Aktivizimi: `stop.bat` → `start.bat`, pastaj Ctrl+F5 dhe rihap lojën. Për reskin-in përdor paketën e përditësuar **TRANSFER-RESKIN**; mos kopjo `.env` ose `data`.
