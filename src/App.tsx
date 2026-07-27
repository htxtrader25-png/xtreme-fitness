import { useEffect, useState } from 'react';
import { useFleetStore } from '@/store/useFleetStore';
import { AppHeader } from '@/components/AppHeader';
import { CommandCenter } from '@/components/command/CommandCenter';
import { StemModal } from '@/components/modals/StemModal';
import { FleetScheduler } from '@/components/scheduler/FleetScheduler';
import { SchedulerToolbar } from '@/components/scheduler/SchedulerToolbar';
import { OptimizationView } from '@/components/optimization/OptimizationView';
import { ScenarioView } from '@/components/scenarios/ScenarioView';
import { ReplayView } from '@/components/replay/ReplayView';
import { FleetMap } from '@/components/map/FleetMap';
import { AnalyticsView } from '@/components/analytics/AnalyticsView';
import { useDerived } from '@/store/useDerived';

export type ModuleId =
  | 'scheduler'
  | 'optimization'
  | 'scenarios'
  | 'replay'
  | 'map'
  | 'analytics';

export default function App() {
  const [module, setModule] = useState<ModuleId>('scheduler');
  const modal = useFleetStore((s) => s.modal);
  const editingStemId = useFleetStore((s) => s.editingStemId);
  const setClock = useFleetStore((s) => s.setClock);

  // Advance the operational clock (drives KPIs, snapshots, current-time marker).
  useEffect(() => {
    setClock(Date.now());
    const id = setInterval(() => setClock(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [setClock]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-panel-900 text-slate-200">
      <AppHeader active={module} onNavigate={setModule} />

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          {module === 'scheduler' && <SchedulerModule />}
          {module === 'optimization' && <OptimizationView />}
          {module === 'scenarios' && <ScenarioView />}
          {module === 'replay' && <ReplayView />}
          {module === 'map' && <FleetMap />}
          {module === 'analytics' && <AnalyticsView />}
        </main>

        <CommandCenter />
      </div>

      {modal && <StemModal key={`${modal}:${editingStemId ?? 'new'}`} />}
    </div>
  );
}

function SchedulerModule() {
  const { conflicts } = useDerived();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SchedulerToolbar conflictCount={conflicts.length} />
      <div className="min-h-0 flex-1">
        <FleetScheduler />
      </div>
    </div>
  );
}
