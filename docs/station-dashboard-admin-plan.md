# Station Dashboard Admin Plan

## Goal

Station dashboard customization should be managed through the web/admin backend and read by the Turnout station display at runtime. Station image, background, card rotation, messages, apparatus configuration, and display options should not require a Turnout code release.

## Source Of Truth

The New MTFD Site backend remains the source of truth. Turnout should read station settings through shared APIs, the same way it reads dispatch stats and station messages.

## Data Model

Add a `StationDashboardConfig` table on the web/backend side:

- `id`
- `stationNumber`
- `stationLabel`
- `logoUrl`
- `backgroundImageUrl`
- `backgroundMode`
- `enabledCards`
- `cardRotationSeconds`
- `messageFilters`
- `apparatusUnitIds`
- `weatherStationId`
- `displayFlags`
- `createdByUserId`
- `updatedByUserId`
- `createdAt`
- `updatedAt`

Keep message content in `MessageCenterItem`; config should reference filters and display behavior, not duplicate messages.

## Permissions

Allow access for:

- `ADMIN`
- `CHIEF`
- `BATTALION_CHIEF`
- approved officer/admin delegates

Volunteer station officers should only manage their assigned station unless specifically granted broader rights.

## APIs

Add shared read API:

- `GET /api/shared/station-dashboard-config?stationNumber=2`

Add admin APIs:

- `GET /api/admin/station-dashboard-config`
- `GET /api/admin/station-dashboard-config/:stationNumber`
- `PATCH /api/admin/station-dashboard-config/:stationNumber`

Turnout should cache the config briefly and fall back to bundled defaults if the shared API is temporarily unavailable.

## Admin UI

Add a web/admin screen for each station:

- station logo/image upload or URL
- dashboard background upload or URL
- card enable/disable controls
- card rotation timing
- station message display filters
- apparatus assignment
- weather/display options
- preview panel showing the station display settings

## Rollout

1. Add database model and migration.
2. Add admin permission checks.
3. Add shared config read API.
4. Update Turnout to consume shared config with existing hardcoded settings as fallback.
5. Add admin UI.
6. Migrate current Station 1-5 images/cards into database seed/default config.
