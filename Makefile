# Fission Protocol — Developer Workflow
# Run `make help` to see commands.

.PHONY: help install build daml-build daml-test splice-fetch localnet-up localnet-down \
        bootstrap dev-backend dev-frontend dev-oracle dev-sequencer dev clean

DAML_PACKAGES = \
  daml/fission-asset-registry \
  daml/fission-credential \
  daml/fission-oracle \
  daml/fission-sy \
  daml/fission-py \
  daml/fission-amm \
  daml/fission-tests

help:
	@echo "Fission Protocol — Make targets"
	@echo ""
	@echo "  make install         install all node dependencies"
	@echo "  make daml-build      compile every Daml package to a DAR"
	@echo "  make daml-test       run the end-to-end Daml Script test"
	@echo "  make splice-fetch    download + extract the Splice LocalNet bundle"
	@echo "  make localnet-up     start the Splice LocalNet stack (auto-fetches bundle)"
	@echo "  make localnet-down   stop LocalNet"
	@echo "  make bootstrap       allocate parties, register USYC, deploy markets"
	@echo "  make dev-backend     run the Fastify backend in watch mode"
	@echo "  make dev-frontend    run the Vite frontend in dev mode"
	@echo "  make dev-oracle      run the oracle keeper in watch mode"
	@echo "  make dev-sequencer   run the batch sequencer in watch mode"
	@echo "  make dev             concurrently run all services (requires foreman or similar)"
	@echo "  make clean           remove build artifacts and node_modules"

install:
	cd backend && npm install
	cd frontend && npm install
	cd services/oracle && npm install
	cd services/sequencer && npm install
	cd scripts && npm install

daml-build:
	@for pkg in $(DAML_PACKAGES); do \
		echo "→ daml build: $$pkg"; \
		(cd $$pkg && daml build) || exit 1; \
	done
	@echo "✓ All Daml packages built. DARs in each package's .daml/dist/"

daml-test:
	cd daml/fission-tests && daml test

SPLICE_VERSION ?= 0.6.2
SPLICE_BUNDLE_URL := https://github.com/digital-asset/decentralized-canton-sync/releases/download/v$(SPLICE_VERSION)/$(SPLICE_VERSION)_splice-node.tar.gz

splice-fetch:
	@if [ ! -d "splice-node" ]; then \
		echo "Downloading Splice LocalNet bundle v$(SPLICE_VERSION)..."; \
		curl -sLO $(SPLICE_BUNDLE_URL); \
		tar xzf $(SPLICE_VERSION)_splice-node.tar.gz; \
		rm -f $(SPLICE_VERSION)_splice-node.tar.gz; \
		echo "✓ Bundle extracted to ./splice-node/"; \
	fi
	@if [ ! -L "splice-bundle" ]; then \
		ln -sfn splice-node/docker-compose/localnet splice-bundle; \
		echo "✓ splice-bundle -> splice-node/docker-compose/localnet"; \
	fi
	@if [ ! -f "splice-bundle/.env" ]; then \
		LOCALNET_ABS=$$(cd splice-bundle && pwd) && \
		printf 'IMAGE_REPO=ghcr.io/digital-asset/decentralized-canton-sync/docker/\nIMAGE_TAG=%s\nPOSTGRES_VERSION=14\nNGINX_VERSION=1.27.0\nDOCKER_NETWORK=splice_default\nLOCALNET_DIR=%s\nLOCALNET_ENV_DIR=%s/env\nAPP_PROVIDER_AUTH_ENV=%s/env/app-provider-auth-on.env\nAPP_USER_AUTH_ENV=%s/env/app-user-auth-on.env\nSV_AUTH_ENV=%s/env/sv-auth-on.env\nALPHA_PROTOCOL_VERSION_ENV=%s/env/alpha-protocol-version.env\nSV_PROFILE=on\nAPP_PROVIDER_PROFILE=on\nAPP_USER_PROFILE=on\nPARTY_HINT=fission-localparty-1\nDB_USER=cnadmin\nDB_PASSWORD=supersafe\nDB_SERVER=postgres\nDB_PORT=5432\nPARTICIPANT_LEDGER_API_PORT_SUFFIX=901\nPARTICIPANT_ADMIN_API_PORT_SUFFIX=902\nPARTICIPANT_JSON_API_PORT_SUFFIX=975\nVALIDATOR_ADMIN_API_PORT_SUFFIX=903\nCANTON_HTTP_HEALTHCHECK_PORT_SUFFIX=900\nCANTON_GRPC_HEALTHCHECK_PORT_SUFFIX=961\nAPP_USER_UI_PORT=2000\nAPP_PROVIDER_UI_PORT=3000\nSV_UI_PORT=4000\nSWAGGER_UI_PORT=9090\nSPLICE_SV_IS_DEVNET=true\nSPLICE_APP_VALIDATOR_AUTH_AUDIENCE=https://sv.example.com\nSPLICE_APP_CONTACT_POINT=\nSPLICE_APP_UI_NETWORK_NAME=Splice\nSPLICE_APP_UI_NETWORK_FAVICON_URL=https://www.hyperledger.org/hubfs/hyperledgerfavicon.png\nSPLICE_APP_UI_AMULET_NAME=Amulet\nSPLICE_APP_UI_AMULET_NAME_ACRONYM=AMT\nSPLICE_APP_UI_NAME_SERVICE_NAME=Amulet Name Service\nSPLICE_APP_UI_NAME_SERVICE_NAME_ACRONYM=ANS\nSPLICE_APP_UI_AUTH_AUDIENCE=https://sv.example.com\nSPLICE_APP_UI_UNSAFE=true\nSPLICE_APP_UI_UNSAFE_SECRET=unsafe\nSPLICE_APP_UI_HTTP_URL=true\n' \
			$(SPLICE_VERSION) "$$LOCALNET_ABS" "$$LOCALNET_ABS" "$$LOCALNET_ABS" "$$LOCALNET_ABS" "$$LOCALNET_ABS" "$$LOCALNET_ABS" > splice-bundle/.env; \
		echo "✓ wrote splice-bundle/.env"; \
	fi

localnet-up: splice-fetch
	cd splice-bundle && COMPOSE_PROFILES=sv,app-provider,app-user docker compose up -d
	@echo "✓ LocalNet up. Wallet UI: http://wallet.localhost:2000"
	@echo "                Ledger API: http://localhost:2975"
	@echo "                JSON API:   http://localhost:2975/v2/version"

localnet-down:
	cd splice-bundle && docker compose down

bootstrap:
	@echo "Uploading DARs to participant..."
	@for pkg in $(DAML_PACKAGES); do \
		dar=$$(ls $$pkg/.daml/dist/*.dar 2>/dev/null | head -1); \
		if [ -n "$$dar" ]; then \
			echo "  $$dar"; \
			curl -s -X POST http://localhost:2975/v2/packages \
			  -H "Content-Type: application/octet-stream" \
			  -H "Authorization: Bearer $$(scripts/get-admin-token.sh)" \
			  --data-binary @$$dar > /dev/null; \
		fi; \
	done
	@echo "Running bootstrap script..."
	cd scripts && npm run bootstrap

dev-backend:
	cd backend && npm run dev

dev-frontend:
	cd frontend && npm run dev

dev-oracle:
	cd services/oracle && npm run dev

dev-sequencer:
	cd services/sequencer && npm run dev

dev:
	@echo "Starting all services. Use Ctrl+C to stop."
	@(trap 'kill 0' SIGINT; \
	  $(MAKE) dev-backend & \
	  $(MAKE) dev-frontend & \
	  $(MAKE) dev-oracle & \
	  $(MAKE) dev-sequencer & \
	  wait)

clean:
	rm -rf backend/node_modules backend/dist
	rm -rf frontend/node_modules frontend/dist
	rm -rf services/oracle/node_modules services/sequencer/node_modules
	rm -rf scripts/node_modules
	@for pkg in $(DAML_PACKAGES); do \
		rm -rf $$pkg/.daml; \
	done
