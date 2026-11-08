import {createStatsService} from './service.mjs';
import {eventWatchIds,saveEventEvidence,loadEventEvidence} from '../ledger/event-evidence.mjs';
import {getMatchById} from '../matches.mjs';
import {matchSnapshots} from '../ledger/match-snapshots.mjs';
import {persistHistoricalGoalFacts} from '../ledger/historical-event-facts.mjs';
import {persistHistoricalTimedEvents} from '../ledger/historical-timed-events.mjs';
async function saveStats(id,evidence){
 const old=await loadEventEvidence(id),bySource=new Map();
 for(const item of [old,...(old?.alternatives??[]),evidence].filter(Boolean)){
  const {alternatives,...snapshot}=item;bySource.set(snapshot.source,snapshot);
 }
 const alternatives=[...bySource.values()].filter(x=>x.source!==evidence.source).slice(-4);
 return saveEventEvidence(id,{...evidence,alternatives});
}
export const statsProviders=createStatsService({getEventWatchIds:eventWatchIds,saveEvidence:saveStats,
 persistGoalFacts:(matchId,evidence)=>persistHistoricalGoalFacts(matchId,evidence),
 persistTimedFacts:(matchId,evidence)=>persistHistoricalTimedEvents(matchId,evidence),
 loadMatch:getMatchById,loadSnapshots:ids=>matchSnapshots.load(ids)});
