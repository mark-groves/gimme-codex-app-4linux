.PHONY: build check install local-diagnostics omarchy-install upstream

check:
	bash -n scripts/check-local.sh scripts/install-local.sh scripts/omarchy-quickstart.sh
	node --check scripts/check-upstream.mjs
	node --check scripts/build-linux-app.mjs
	node --check scripts/extract-asar.mjs
	node --check scripts/lib/asar.mjs

build:
	node scripts/build-linux-app.mjs --channel prod

install:
	bash scripts/install-local.sh

upstream:
	node scripts/check-upstream.mjs

local-diagnostics:
	bash scripts/check-local.sh

omarchy-install:
	bash scripts/omarchy-quickstart.sh
