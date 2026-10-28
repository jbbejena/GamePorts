"""Run from the repository root with: python -m warfare1944."""

try:
    from .standalone import main
except ModuleNotFoundError as error:
    if error.name != "aiohttp":
        raise
    raise SystemExit("Install the local server first: python -m pip install -r requirements-local.txt") from error

main()
