import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, Loader2, X } from 'lucide-react';
import { adminUiText, adminUiError } from './adminUiCopy';
import { useLanguage } from '../../context/LanguageContext';
import { formatMarketSelectionLabel, translateOutcomeName } from '../../utils/sportsbookLabels';
import { formatOdds } from '../../utils/formatOdds';
import { MAX_ADMIN_ODDS, previewAdjustments } from './matchControlModel';
import type { ControlDialog } from './matchControlModel';

type Props = {
  dialog: ControlDialog;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSaveOdds: (odds: number) => Promise<void>;
  onAdjust: (percentage: number) => Promise<void>;
  onSettle: (home: number, away: number) => Promise<void>;
};

const decimalValue = (raw: string) => {
  const value = raw.trim().replace(',', '.');
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? Number(value) : NaN;
};
const scoreValue = (raw: string) => {
  if (!/^\d+$/.test(raw.trim())) return NaN;
  const score = Number(raw);
  return Number.isSafeInteger(score) && score <= 2_147_483_647 ? score : NaN;
};
// The server stores manual prices at three decimals. Preserve those digits in
// the review instead of presenting a different price from the one being saved.
const exactPrice = (value: number) => {
  if (!Number.isFinite(value)) return '—';
  const text = String(value);
  return (text.split('.')[1]?.length ?? 0) < 2 ? value.toFixed(2) : text;
};

export default function MatchControlDialog({ dialog, busy, error, onClose, onSaveOdds, onAdjust, onSettle }: Props) {
  const { t, lang } = useLanguage();
  const tr = (value: string) => adminUiText(value, lang);
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const [odds, setOdds] = useState(dialog.kind === 'odds' ? String(dialog.outcome.odds ?? '') : '');
  const [percentage, setPercentage] = useState('5');
  const [homeScore, setHomeScore] = useState(String(dialog.match.homeScore ?? 0));
  const [awayScore, setAwayScore] = useState(String(dialog.match.awayScore ?? 0));
  const locked = busy || submitting;
  closeRef.current = onClose;
  busyRef.current = locked;

  const title = dialog.kind === 'odds' ? tr('Ndrysho kuotën')
    : dialog.kind === 'adjust' ? tr('Rregullo kuotat') : tr('Vendos rezultatin');
  const fixture = `${dialog.match.homeTeam} – ${dialog.match.awayTeam}`;
  const fixtureKey = `${dialog.match.homeTeam} vs ${dialog.match.awayTeam}`;
  const oddsNumber = decimalValue(odds);
  const oddsDraft = Number(oddsNumber.toFixed(3));
  const oddsDraftValid = Number.isFinite(oddsNumber) && oddsNumber > 1 && oddsNumber <= MAX_ADMIN_ODDS
    && Number.isFinite(oddsDraft) && oddsDraft > 1 && oddsDraft <= MAX_ADMIN_ODDS;
  const percentageNumber = decimalValue(percentage);
  const preview = useMemo(() => dialog.kind === 'adjust'
    ? previewAdjustments(dialog.outcomes, percentageNumber) : [], [dialog, percentageNumber]);
  const outcomeMarkets = useMemo(() => new Map((dialog.match.markets ?? []).flatMap(market =>
    (market.outcomes ?? []).map(outcome => [outcome.id, market] as const))), [dialog.match]);

  useEffect(() => {
    mountedRef.current = true;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
    ) ?? [])].filter(element => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
    const focusFrame = requestAnimationFrame(() => {
      const input = dialogRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)');
      (input ?? focusable()[0] ?? dialogRef.current)?.focus({ preventScroll: true });
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current && !submittingRef.current) closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const fields = focusable();
      const first = fields[0];
      const last = fields[fields.length - 1];
      const current = fields.indexOf(document.activeElement as HTMLElement);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus({ preventScroll: true });
      } else if (event.shiftKey && current <= 0) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current < 0 || current === fields.length - 1)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', keydown, true);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected && !previouslyFocused.matches(':disabled')) {
        previouslyFocused.focus({ preventScroll: true });
      } else {
        // A saved action can be followed by a failed refresh that keeps its
        // opener disabled. Leave focus on the available recovery control.
        document.querySelector<HTMLButtonElement>('.match-control .mc-heading button:not(:disabled)')?.focus({ preventScroll: true });
      }
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || submittingRef.current) return;
    let save: () => Promise<void>;
    if (dialog.kind === 'odds') {
      if (!oddsDraftValid) {
        setLocalError(tr('Vendos një kuotë të vlefshme më të madhe se 1. Kuota ruhet deri në tri shifra pas presjes.'));
        return;
      }
      save = () => onSaveOdds(oddsDraft);
    } else if (dialog.kind === 'adjust') {
      if (!Number.isFinite(percentageNumber) || percentageNumber <= -100 || percentageNumber === 0) {
        setLocalError(tr('Vendos një përqindje më të madhe se -100 dhe të ndryshme nga zero.'));
        return;
      }
      if (!preview.length || preview.some(item => !item.valid)) {
        setLocalError(tr('Ndryshimi duhet të lërë çdo kuotë të vlefshme dhe më të madhe se 1. Rregullo përqindjen përpara ruajtjes.'));
        return;
      }
      save = () => onAdjust(percentageNumber);
    } else {
      const home = scoreValue(homeScore);
      const away = scoreValue(awayScore);
      if (!Number.isFinite(home) || !Number.isFinite(away)) {
        setLocalError(tr('Golat e të dy ekipeve duhet të jenë numra të plotë, zero ose më shumë.'));
        return;
      }
      save = () => onSettle(home, away);
    }
    // Set this immediately: two submissions in the same frame must not start
    // two mutations before the parent's busy state has rendered.
    submittingRef.current = true;
    busyRef.current = true;
    setSubmitting(true);
    setLocalError('');
    try {
      await save();
    } catch {
      // The parent owns API feedback and refreshes the authoritative state.
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  const shownError = adminUiError(localError || error, lang);
  const close = () => {
    if (!busyRef.current && !submittingRef.current) closeRef.current();
  };
  return (
    <div className="mc-dialog-backdrop" onClick={event => {
      if (event.target === event.currentTarget && !busyRef.current && !submittingRef.current) closeRef.current();
    }}>
      <div ref={dialogRef} className="mc-dialog" role="dialog" aria-modal="true" aria-label={title}
        aria-describedby={descriptionId} aria-busy={locked} tabIndex={-1}>
        <form className="mc-dialog-form" noValidate onSubmit={submit}>
          <header className="mc-dialog-heading">
            <div><h3>{title}</h3><p id={descriptionId}>{fixture}</p></div>
            <button type="button" className="mc-icon-button" aria-label={tr("Mbyll dritaren")} disabled={locked} onClick={close}><X size={19} /></button>
          </header>
          <div className="mc-dialog-body">
            {dialog.kind === 'odds' && <>
              <div className="mc-review">
                <span>{formatMarketSelectionLabel(dialog.market.name, dialog.market.line, t)}</span>
                <strong>{translateOutcomeName(dialog.outcome.name, t, dialog.market.name, fixtureKey, dialog.outcome.code)}</strong>
                <p>{tr("Kuota aktuale:")}{' '}<b>{exactPrice(Number(dialog.outcome.odds))}</b></p>
              </div>
              <label className="mc-field"><span>{tr("Kuota e re")}</span>
                <input aria-label={tr("Kuota e re")} type="text" inputMode="decimal" autoComplete="off" value={odds} disabled={locked}
                  aria-invalid={Boolean(localError)} onChange={event => { setOdds(event.target.value); setLocalError(''); }} />
                <small>{tr("Pranohet edhe presja dhjetore. Ruajtja përdor deri në tri shifra pas presjes.")}</small>
              </label>
              <div className="mc-quick-values" aria-label={tr("Ndrysho kuotën me hapa")}>
                {[-0.1, -0.05, 0.05, 0.1].map(step => <button key={step} type="button" className="mc-button" disabled={locked}
                  onClick={() => {
                    const current = decimalValue(odds);
                    setOdds(String(Number(Math.min(MAX_ADMIN_ODDS, Math.max(1.01, (Number.isFinite(current) ? current : 1.01) + step)).toFixed(3))));
                    setLocalError('');
                  }}>{step > 0 ? '+' : ''}{step.toFixed(2)}</button>)}
              </div>
              <div className="mc-preview" aria-label={tr("Kuota aktuale dhe kuota për ruajtje")}><div>
                <div><strong>{tr("Për ruajtje")}</strong><small>{tr("Kuota përpara dhe pas ndryshimit")}</small></div>
                <div><span data-admin-preview-before={dialog.outcome.odds}>{exactPrice(Number(dialog.outcome.odds))}</span><ArrowRight size={15} aria-hidden="true" />
                  <strong data-admin-preview-after={oddsDraft}>{oddsDraftValid ? exactPrice(oddsDraft) : tr('E pavlefshme')}</strong>
                  {oddsDraftValid && <small>{tr("Në faqe:")}{' '}{formatOdds(oddsDraft)}</small>}</div>
              </div></div>
              <p className="mc-review">{tr("Kuota e vendosur këtu ka përparësi ndaj kuotës së furnizuesit.")}</p>
            </>}
            {dialog.kind === 'adjust' && <>
              <div className="mc-review"><strong>{dialog.scope === 'match' ? tr('Të gjitha kuotat e ndeshjes') : (() => { const market = dialog.match.markets?.find(item => item.id === dialog.id); return market ? formatMarketSelectionLabel(market.name, market.line, t) : tr(dialog.title); })()}</strong><p>{tr("Shiko vlerat e reja përpara se të zbatosh ndryshimin.")}</p></div>
              <label className="mc-field"><span>{tr("Përqindja e ndryshimit")}</span>
                <input aria-label={tr("Përqindja e ndryshimit")} type="text" inputMode="decimal" autoComplete="off" value={percentage} disabled={locked}
                  aria-invalid={Boolean(localError)} onChange={event => { setPercentage(event.target.value); setLocalError(''); }} />
                <small>{tr("Vlerat pozitive rrisin kuotat; vlerat negative i ulin.")}</small>
              </label>
              <div className="mc-quick-values" aria-label={tr("Përqindjet e shpejta")}>
                {[-10, -5, 5, 10].map(value => <button key={value} type="button" className="mc-button" disabled={locked}
                  aria-pressed={percentageNumber === value} onClick={() => { setPercentage(String(value)); setLocalError(''); }}>{value > 0 ? '+' : ''}{value}%</button>)}
              </div>
              <div className="mc-review"><strong>{preview.length}{' '}{tr("kuota për ndryshim")}</strong>
                {dialog.outcomes.length > preview.length && <p>{dialog.outcomes.length - preview.length}{' '}{tr("zgjedhje pa kuotë të vlefshme anashkalohen.")}</p>}
                <p>{tr("Nëse ruajtja përfundon pjesërisht, riprovimi përdor kuotat fillestare të kësaj dritareje. Ndryshimi nuk grumbullohet dy herë; rihap dritaren për një rregullim të ri.")}</p>
              </div>
              <div className="mc-preview" aria-label={tr("Paraqitja e kuotave para dhe pas ndryshimit")}>
                {preview.map(item => {
                  const market = outcomeMarkets.get(item.outcome.id);
                  return <div key={item.outcome.id} className={item.valid ? '' : 'mc-preview-invalid'}>
                    <div><strong>{translateOutcomeName(item.outcome.name, t, market?.name, fixtureKey, item.outcome.code)}</strong>
                      {market && <small>{formatMarketSelectionLabel(market.name, market.line, t)}</small>}</div>
                    <div><span data-admin-preview-before={item.previous}>{exactPrice(item.previous)}</span><ArrowRight size={15} aria-hidden="true" />
                      <strong data-admin-preview-after={item.next}>{item.valid ? exactPrice(item.next) : tr('E pavlefshme')}</strong>
                      {item.valid && <small>{tr("Në faqe:")}{' '}{formatOdds(item.next)}</small>}</div>
                  </div>;
                })}
              </div>
            </>}
            {dialog.kind === 'settle' && <>
              <div className="mc-review"><strong>{tr("Kontrollo rezultatin përfundimtar")}</strong>
                <p>{tr("Rezultati do të përdoret për të përditësuar skedinat dhe pagesat përkatëse. Tregjet që kërkojnë të dhëna të tjera mund të mbeten në pritje.")}</p>
              </div>
              <div className="mc-score-inputs">
                {[
                  { team: dialog.match.homeTeam, value: homeScore, change: setHomeScore },
                  { team: dialog.match.awayTeam, value: awayScore, change: setAwayScore },
                ].map((field, index) => <label key={index} className="mc-field"><span>{field.team}</span>
                  <input aria-label={tr(`Golat e ${field.team}`)} type="text" inputMode="numeric" autoComplete="off" value={field.value} disabled={locked}
                    aria-invalid={Boolean(localError)} onChange={event => { field.change(event.target.value); setLocalError(''); }} />
                </label>)}
              </div>
              <p className="mc-review">{tr("Rezultati për ruajtje:")}{' '}<strong>{dialog.match.homeTeam} {homeScore || '—'} – {awayScore || '—'} {dialog.match.awayTeam}</strong></p>
            </>}
            {shownError && <div className="mc-error" role="alert">{shownError}</div>}
          </div>
          <footer className="mc-dialog-actions">
            <button type="button" className="mc-button" disabled={locked} onClick={close}>{tr("Anulo")}</button>
            <button type="submit" className={`mc-button ${dialog.kind === 'settle' ? 'mc-button-danger' : 'mc-button-primary'}`} disabled={locked}>
              {locked && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {dialog.kind === 'odds' ? tr('Ruaj kuotën') : dialog.kind === 'adjust' ? tr('Zbato ndryshimin') : tr('Ruaj dhe përditëso skedinat')}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
