#!/bin/sh
# Regenerates the translation template from the sources listed in POTFILES.in,
# merges it into every catalog and compiles the binary ones.
set -e

SCRIPTDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOTDIR=$(CDPATH= cd -- "${SCRIPTDIR}/../.." && pwd)
POTFILE="${SCRIPTDIR}/quake-any-app.pot"
DOMAIN="quake-any-app@AllYouZombies.github.io"

xgettext --from-code=UTF-8 -k_ -kN_ \
	--package-name="Quake Any App" \
	--msgid-bugs-address="https://github.com/AllYouZombies/quake-any-app/issues" \
	--directory="${ROOTDIR}" \
	--files-from="${SCRIPTDIR}/POTFILES.in" \
	--output="${POTFILE}"

for fn in "${SCRIPTDIR}"/*.po; do
	lang=$(basename "${fn}" .po)
	msgmerge --update --backup=none "${fn}" "${POTFILE}"
	mkdir -p "${SCRIPTDIR}/locale/${lang}/LC_MESSAGES"
	msgfmt --check --statistics \
		--output-file="${SCRIPTDIR}/locale/${lang}/LC_MESSAGES/${DOMAIN}.mo" \
		"${fn}"
done
