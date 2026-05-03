.PHONY: build check install local-diagnostics omarchy-install pacman-package smoke-test update upstream

check:
	bash -n scripts/build-pacman-package.sh scripts/check-local.sh scripts/install-local.sh scripts/omarchy-quickstart.sh scripts/smoke-test.sh scripts/test-install-local.sh
	node --check scripts/check-upstream.mjs
	node --check scripts/build-linux-app.mjs
	node --check scripts/extract-asar.mjs
	node --check scripts/lib/asar.mjs
	node --check scripts/update-local.mjs
	node --check scripts/test-update-local.mjs
	bash scripts/test-install-local.sh
	node scripts/test-update-local.mjs

build:
	node scripts/build-linux-app.mjs --channel prod

install:
	bash scripts/install-local.sh

update:
	node scripts/update-local.mjs

upstream:
	node scripts/check-upstream.mjs

local-diagnostics:
	bash scripts/check-local.sh

omarchy-install:
	bash scripts/omarchy-quickstart.sh

pacman-package:
	bash scripts/build-pacman-package.sh

smoke-test:
	bash scripts/smoke-test.sh
