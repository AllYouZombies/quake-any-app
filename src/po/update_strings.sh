#!/bin/sh
SCRIPTDIR=`dirname $0`
xgettext --from-code=UTF-8 -k_ -kN_ \
  --package-name="Quake Any App" \
  --msgid-bugs-address="https://github.com/AllYouZombies/quake-any-app/issues" \
  -o "${SCRIPTDIR}/quake-any-app.pot" \
  "${SCRIPTDIR}"/../src/*.js

for fn in "${SCRIPTDIR}"/*.po; do
	msgmerge -U "$fn" "${SCRIPTDIR}/quake-any-app.pot"
done
