// Jabeja fork: one store per instance behind the voordeur (lib/omgevingen.ts).
// Every store hydrates and keeps its own live stream from the start; the app
// renders once, on the active instance's store, so going to a bot of another
// instance swaps the store under the same screen: no reload, no new fetch of
// what was already there. The sidebar shows each instance's bots from that
// instance's own store (OmgevingStore). With one instance this is just the
// upstream StoreProvider.
import { useMemo, useSyncExternalStore, type ReactNode } from "react";

import { openOmgevingen, setActieveOmgeving, useActieveOmgeving } from "@/lib/omgevingen";
import { ProvideStore, StoreProvider, type useStore } from "./store";

type StoreValue = ReturnType<typeof useStore>;

const values = new Map<string, StoreValue>();
const listeners = new Set<() => void>();
const publishers = new Map<string, (value: StoreValue) => void>();
let allValues: StoreValue[] = [];
let byNaam: ReadonlyMap<string, StoreValue> = new Map();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** One stable callback per instance: a store hands its value up through it. */
function publisherFor(naam: string): (value: StoreValue) => void {
  let publish = publishers.get(naam);
  if (!publish) {
    publish = (value) => {
      values.set(naam, value);
      allValues = openOmgevingen().map((o) => values.get(o.naam)).filter((v): v is StoreValue => Boolean(v));
      byNaam = new Map(values);
      for (const listener of listeners) listener();
    };
    publishers.set(naam, publish);
  }
  return publish;
}

/** One instance's store; undefined until it first renders. */
export function useStoreOf(naam: string | null): StoreValue | undefined {
  return useSyncExternalStore(subscribe, () => (naam ? values.get(naam) : undefined), () => undefined);
}

/** Every open instance's store, in sidebar order ([] with one instance). */
export function useAllStores(): StoreValue[] {
  return useSyncExternalStore(subscribe, () => allValues, () => allValues);
}

/** Every open instance's store by name. */
export function useStoresByOmgeving(): ReadonlyMap<string, StoreValue> {
  return useSyncExternalStore(subscribe, () => byNaam, () => byNaam);
}

export function OmgevingStores({ children }: { children: ReactNode }) {
  const open = openOmgevingen();
  if (!open.length) return <StoreProvider>{children}</StoreProvider>;
  return (
    <>
      {open.map((o) => <StoreProvider key={o.naam} omgeving={o.naam} onValue={publisherFor(o.naam)} />)}
      <ActiveStore>{children}</ActiveStore>
    </>
  );
}

function ActiveStore({ children }: { children: ReactNode }) {
  const value = useStoreOf(useActieveOmgeving());
  return value ? <ProvideStore value={value}>{children}</ProvideStore> : null;
}

/** An instance's own store for a piece of the sidebar. Not the active one:
 * nothing shows as selected there, and whatever is done from it (opening a
 * bot, a new conversation) makes that instance the active one first. */
export function OmgevingStore({ naam, children }: { naam: string; children: ReactNode }) {
  const value = useStoreOf(naam);
  const active = useActieveOmgeving() === naam;
  const shown = useMemo<StoreValue | undefined>(() => {
    if (!value || active) return value;
    return {
      ...value,
      state: { ...value.state, selectedId: "" },
      dispatch: (action) => {
        setActieveOmgeving(naam);
        value.dispatch(action);
      },
    };
  }, [value, active, naam]);
  return shown ? <ProvideStore value={shown}>{children}</ProvideStore> : null;
}
