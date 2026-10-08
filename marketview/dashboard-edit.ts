import {
  type ArtifactRef,
  type ArtifactRegistry,
  type Ref,
} from '../artifact-registry/index.js';
import type {
  DashboardChange,
  DashboardModule,
} from '../dashboard/index.js';
import {
  canonicalDashboardIdentity,
  isDashboardAliasCandidate,
  isDashboardIdCandidate,
} from './dashboard-resolution.js';

import type { MarketViewDashboardEditResult } from './types.js';

type MarketViewDashboardEditError = Extract<MarketViewDashboardEditResult, { ok: false }>['error'];

export interface MarketViewDashboardEdit {
  edit(input: {
    target: string;
    addWidgetRefs: readonly string[];
    removeWidgetRefs: readonly string[];
    addSectionNames: readonly string[];
    removeSectionRefs: readonly string[];
    orderRefs?: readonly string[];
  }): Promise<MarketViewDashboardEditResult>;
}

type ResolvedTarget = Readonly<{
  dashboardId: string;
  sectionId?: string;
  label: string;
  /** The Dashboard's ref when the target was given as a ref. */
  dashboardRef?: string;
}>;

type ChangePresentation = Readonly<{ action: string; target: string | readonly string[] }>;
type PresentedChange = Readonly<{
  change: DashboardChange;
  presentation: ChangePresentation;
}>;
type ChangeResolution =
  | { ok: true; value: PresentedChange }
  | { ok: false; error: MarketViewDashboardEditError };

function refName(registry: ArtifactRegistry, input: string): Ref {
  return registry.refName(input);
}

function resolveRef(registry: ArtifactRegistry, input: string): ArtifactRef | undefined {
  return registry.resolveRef(refName(registry, input));
}

function resolveTarget(
  registry: ArtifactRegistry,
  input: string,
): { ok: true; value: ResolvedTarget } | { ok: false; error: MarketViewDashboardEditError } {
  if (input.startsWith('@')) {
    const name = refName(registry, input);
    const ref = registry.resolveRef(name);
    if (!ref) return { ok: false, error: { kind: 'unknown-ref', refName: name } };
    if (ref.type === 'dashboard') {
      return { ok: true, value: { dashboardId: ref.dashboardId, label: `@${name}`, dashboardRef: name } };
    }
    if (ref.type === 'section') {
      return {
        ok: true,
        value: {
          dashboardId: ref.dashboardId,
          sectionId: ref.sectionId,
          label: `@${name}`,
          dashboardRef: name.slice(0, name.lastIndexOf('.')),
        },
      };
    }
    return { ok: false, error: { kind: 'wrong-target', refName: name, artifactType: ref.type } };
  }
  const identity = canonicalDashboardIdentity(input);
  if (!isDashboardIdCandidate(identity) && !isDashboardAliasCandidate(identity)) {
    return { ok: false, error: { kind: 'invalid-input', reason: 'free-text-target', targetLabel: input } };
  }
  return { ok: true, value: { dashboardId: identity, label: identity } };
}

function claimDashboardRef(registry: ArtifactRegistry, dashboardId: string): string {
  const ref = registry.claimDashboard();
  registry.setRefs(ref, { [ref]: { type: 'dashboard', dashboardId } });
  return ref;
}

/** A Dashboard, Section or Dashboard tile ref carries its Dashboard; every other ref has none. */
type DashboardOwnedRef = Readonly<{ type: ArtifactRef['type']; dashboardId?: string }>;

function foreignRef(
  registry: ArtifactRegistry,
  target: ResolvedTarget,
  requestedRef: string,
  ref: DashboardOwnedRef,
): MarketViewDashboardEditError | undefined {
  return ref.dashboardId !== target.dashboardId
    ? { kind: 'foreign-ref', refName: refName(registry, requestedRef), dashboardId: ref.dashboardId ?? '' }
    : undefined;
}

type DashboardWidgetRef = Extract<ArtifactRef, { type: 'widget' }> & Readonly<{
  dashboardId: string;
  childId: string;
}>;

function isDashboardWidgetRef(ref: ArtifactRef): ref is DashboardWidgetRef {
  return 'childId' in ref;
}

function resolveOwnedRef(
  registry: ArtifactRegistry,
  target: ResolvedTarget,
  requestedRef: string,
): { ok: true; value: Readonly<{ name: string; ref: ArtifactRef }> } | { ok: false; error: MarketViewDashboardEditError } {
  const name = refName(registry, requestedRef);
  const ref = resolveRef(registry, requestedRef);
  if (!ref) return { ok: false, error: { kind: 'unknown-ref', refName: name } };
  const foreign = foreignRef(registry, target, requestedRef, ref);
  if (foreign) return { ok: false, error: foreign };
  return { ok: true, value: { name, ref } };
}

function resolveRemoveWidgetChange(
  registry: ArtifactRegistry,
  target: ResolvedTarget,
  requestedRef: string,
): ChangeResolution {
  const removed = resolveOwnedRef(registry, target, requestedRef);
  if (!removed.ok) return removed;
  const { name, ref } = removed.value;
  if (isDashboardWidgetRef(ref)) {
    return {
      ok: true,
      value: {
        change: {
          kind: 'remove-child',
          childId: ref.childId,
          widget: {
            widgetId: ref.widgetId,
            ...(ref.configurationId !== null ? { configurationId: ref.configurationId } : {}),
            ...(ref.selectedContext !== null ? { selectedContext: ref.selectedContext } : {}),
          },
          ...(target.sectionId ? { sectionId: target.sectionId } : {}),
        },
        presentation: { action: 'remove', target: `@${name}` },
      },
    };
  }
  return { ok: false, error: { kind: 'wrong-change-ref', refName: name, artifactType: ref.type } };
}

function resolveRemoveSectionChange(
  registry: ArtifactRegistry,
  target: ResolvedTarget,
  requestedRef: string,
): ChangeResolution {
  const removed = resolveOwnedRef(registry, target, requestedRef);
  if (!removed.ok) return removed;
  const { name, ref } = removed.value;
  if (ref.type === 'section' && !target.sectionId) {
    return {
      ok: true,
      value: {
        change: { kind: 'remove-section', sectionId: ref.sectionId },
        presentation: { action: 'remove', target: `@${name}` },
      },
    };
  }
  return { ok: false, error: { kind: 'wrong-change-ref', refName: name, artifactType: ref.type } };
}

function resolveAddChange(
  registry: ArtifactRegistry,
  target: ResolvedTarget,
  requestedRef: string,
): ChangeResolution {
  const name = refName(registry, requestedRef);
  const ref = resolveRef(registry, requestedRef);
  if (!ref) return { ok: false, error: { kind: 'unknown-ref', refName: name } };
  if (ref.type !== 'widget') {
    return { ok: false, error: { kind: 'wrong-change-ref', refName: name, artifactType: ref.type } };
  }
  return {
    ok: true,
    value: {
      change: {
        kind: 'add-widget',
        widget: {
          widgetId: ref.widgetId,
          ...(ref.configurationId !== null ? { configurationId: ref.configurationId } : {}),
          ...(ref.selectedContext !== null ? { selectedContext: ref.selectedContext } : {}),
        },
        ...(target.sectionId ? { sectionId: target.sectionId } : {}),
        ...(
          target.sectionId &&
          isDashboardWidgetRef(ref) &&
          target.dashboardId === ref.dashboardId
            ? { childId: ref.childId }
            : {}
        ),
      },
      presentation: { action: 'add', target: `@${name}` },
    },
  };
}

function resolveSectionOrder(
  registry: ArtifactRegistry,
  target: ResolvedTarget & { sectionId: string },
  requestedRefs: readonly string[],
): ChangeResolution {
  const childIds: string[] = [];
  for (const requestedRef of requestedRefs) {
    const resolved = resolveOwnedRef(registry, target, requestedRef);
    if (!resolved.ok) return resolved;
    const { name, ref } = resolved.value;
    if (!isDashboardWidgetRef(ref)) {
      return { ok: false, error: { kind: 'wrong-change-ref', refName: name, artifactType: ref.type } };
    }
    childIds.push(ref.childId);
  }
  return {
    ok: true,
    value: {
      change: { kind: 'order-section-children', sectionId: target.sectionId, childIds },
      presentation: { action: 'order', target: requestedRefs.map((requested) => `@${refName(registry, requested)}`) },
    },
  };
}

function resolveDashboardOrder(
  registry: ArtifactRegistry,
  target: ResolvedTarget,
  requestedRefs: readonly string[],
): ChangeResolution {
  const sectionIds: string[] = [];
  for (const requestedRef of requestedRefs) {
    const resolved = resolveOwnedRef(registry, target, requestedRef);
    if (!resolved.ok) return resolved;
    const { name, ref } = resolved.value;
    if (ref.type !== 'section') {
      return { ok: false, error: { kind: 'wrong-change-ref', refName: name, artifactType: ref.type } };
    }
    sectionIds.push(ref.sectionId);
  }
  return {
    ok: true,
    value: {
      change: { kind: 'order-sections', sectionIds },
      presentation: { action: 'order', target: requestedRefs.map((requested) => `@${refName(registry, requested)}`) },
    },
  };
}

function resolveOrderChange(
  registry: ArtifactRegistry,
  target: ResolvedTarget,
  requestedRefs: readonly string[],
): ChangeResolution {
  return target.sectionId
    ? resolveSectionOrder(registry, { ...target, sectionId: target.sectionId }, requestedRefs)
    : resolveDashboardOrder(registry, target, requestedRefs);
}

function resolveChanges(
  registry: ArtifactRegistry,
  target: ResolvedTarget,
  input: Parameters<MarketViewDashboardEdit['edit']>[0],
): { ok: true; value: PresentedChange[] } | { ok: false; error: MarketViewDashboardEditError } {
  const changes: PresentedChange[] = [];
  for (const requestedRef of input.removeWidgetRefs) {
    const resolved = resolveRemoveWidgetChange(registry, target, requestedRef);
    if (!resolved.ok) return resolved;
    changes.push(resolved.value);
  }
  for (const requestedRef of input.removeSectionRefs) {
    const resolved = resolveRemoveSectionChange(registry, target, requestedRef);
    if (!resolved.ok) return resolved;
    changes.push(resolved.value);
  }
  for (const requestedRef of input.addWidgetRefs) {
    const resolved = resolveAddChange(registry, target, requestedRef);
    if (!resolved.ok) return resolved;
    changes.push(resolved.value);
  }
  changes.push(...input.addSectionNames.map((name) => ({
    change: { kind: 'add-section' as const, name },
    presentation: { action: 'add-section', target: name },
  })));
  if (input.orderRefs) {
    const resolved = resolveOrderChange(registry, target, input.orderRefs);
    if (!resolved.ok) return resolved;
    changes.push(resolved.value);
  }
  return { ok: true, value: changes };
}

export function createMarketViewDashboardEdit(dependencies: {
  dashboard: Pick<DashboardModule, 'edit'>;
  registry: ArtifactRegistry;
}): MarketViewDashboardEdit {
  return {
    async edit(input) {
      if (input.addSectionNames.some((name) => !name.trim())) {
        return { ok: false, error: { kind: 'invalid-input', reason: 'blank-section' } };
      }
      if (input.orderRefs && input.orderRefs.length === 0) {
        return { ok: false, error: { kind: 'invalid-input', reason: 'empty-order' } };
      }
      const target = resolveTarget(dependencies.registry, input.target);
      if (!target.ok) return target;
      if (target.value.sectionId && input.addSectionNames.length > 0) {
        return {
          ok: false,
          error: { kind: 'invalid-input', reason: 'section-add-section', targetLabel: target.value.label },
        };
      }
      const resolvedChanges = resolveChanges(dependencies.registry, target.value, input);
      if (!resolvedChanges.ok) return resolvedChanges;
      if (resolvedChanges.value.length === 0) {
        return { ok: false, error: { kind: 'invalid-input', reason: 'no-mutations' } };
      }
      const presentations = new Map<DashboardChange, ChangePresentation>();
      for (const entry of resolvedChanges.value) presentations.set(entry.change, entry.presentation);
      const result = await dependencies.dashboard.edit(
        { kind: 'id', dashboardId: target.value.dashboardId },
        resolvedChanges.value.map(({ change }) => change),
      );
      if (!result.ok) return { ok: false, error: { kind: 'dashboard', error: result.error } };
      return {
        ok: true,
        value: {
          ref: target.value.dashboardRef
            ?? claimDashboardRef(dependencies.registry, result.value.dashboard.dashboardId),
          dashboard: result.value.dashboard,
          entries: result.value.results.map((entry) => {
            const presentation = presentations.get(entry.change);
            if (!presentation) throw new Error(`Missing Dashboard mutation presentation for ${entry.change.kind}`);
            return {
              change: entry.change,
              ...presentation,
              status: entry.status,
              ...(entry.note ? { note: entry.note } : {}),
              ...(entry.error ? { error: entry.error } : {}),
            };
          }),
        },
      };
    },
  };
}
