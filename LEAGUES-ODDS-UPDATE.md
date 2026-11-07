# Filtri i ligave dhe ngjyrat e kuotave

- Angli, Itali, Spanjë, Gjermani, Francë, Portugali: deri në nivelin 3.
- Europa tjetër në listën e mbështetur: vetëm niveli 1.
- Jashtë Europës: vetëm ligat kryesore të lejuara; ndeshjet nuk kanë më
  përjashtim automatik nga kufiri numerik i administratorit.
- Garat kryesore UEFA kanë përparësi. Kupat e tjera dhe ndeshjet e tjera
  të lejuara plotësojnë vetëm vendet e mbetura brenda kufirit prematch.
- Ligat europiane të mbrojtura mund ta tejkalojnë kufirin; admini sheh numrin
  e tyre dhe paralajmërimin përkatës. Kufiri i ruajtur nuk është ndryshuar.
  **0 vazhdon të thotë pa kufi**. Për kufizim vendos një numër pozitiv në
  **Admin → Lista e ndeshjeve**.

Rifreskimet e zakonshme të kuotave prematch përdorin listën e publikuar,
me përparësinë europiane përpara kufirit të abonimeve të serverit.
Ndeshjet e fshehura nuk marrin më këto rifreskime të zakonshme. Ndjekja e
rezultateve për biletat në pritje mbetet veçmas. Nuk janë fshirë bileta,
transaksione ose rezultate. Nuk u ndryshua databaza ose `.env`.

Kur kuota rritet, shifra bëhet jeshile; kur ulet, bëhet e kuqe.
Pas **3 sekondash** kthehet e verdhë. Kjo punon edhe për kuota të zgjedhura
dhe kombinime që llogariten nga dy kuota burimore. Mesazhet për kuota të
tjera dhe rifreskimi me të njëjtin çmim nuk e rifillojnë kohëmatësin.
Kuotat e pezulluara mbeten të bllokuara.

Pas kopjimit të përditësimit, **rinis serverin me stop.bat → start.bat**,
pastaj rifresko shfletuesin me **Ctrl+F5**. Rinisja ngarkon filtrin e ri
dhe krijon abonimet e reja. Pamja zshop dhe një treg për rresht ruhen.

Testet e kaluara: filtri i kampionateve dhe katalogut; kufiri/mbrojtja dhe
përparësia e abonimeve; API e administratorit me databazë të përkohshme;
TypeScript; ngjyrat e kuotave në 1366/390px; pezullimi, skadimi dhe kuponi
në 1366/390/320px; ndërtimi përfundimtar i frontendit.
