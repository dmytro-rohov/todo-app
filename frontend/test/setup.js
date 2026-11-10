// Unit tests check the interface in Polish, the language it is written in (Ukrainian is the default on a new
// device): every test file starts with Polish chosen unless it sets its own localStorage first.
globalThis.localStorage ??= { getItem: key => (key === "mytko-tasks:lang" ? "pl" : null), setItem() {} };
