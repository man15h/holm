// Which search providers the bar asks. Unscoped, every app answers except
// its `scoped` sections (Tags, Lists). Scoped to one app (`!b`), all of
// that app's sections answer. Inside a picked tag or list
// (`Karakeep › #recipes`), only that app's `filters` providers do.

export function providersFor(providers, scope, filter) {
	if (!scope) return providers.filter((p) => !p.scoped);
	return providers.filter((p) => p.integrationId === scope && (!filter || p.filters));
}
