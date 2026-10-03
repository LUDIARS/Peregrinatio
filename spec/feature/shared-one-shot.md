# Shared subscription CLI launch

Text completion and local-image analysis use Lapilli's `@ludiars/one-shot` through
the existing `@peregrinatio/llm` boundary. Lapilli resolves model roles, native CLI
paths and the account-auth environment. Peregrinatio retains stdin prompts, image
directory grants, output parsing, timeout and AbortSignal handling.

Arguments are passed as separate values without a command shell. Image directories
containing spaces or quotes must not be manually shell-quoted. Existing Haiku
defaults and explicit model pins remain supported.

Initialize `lib/lapilli` before dependency installation. Revisor's `setup-lapilli`
obtains its pinned commit before existing checks. Revert both the consumer and
library gitlink to restore the previous implementation. No live inference or
service startup is performed by the implementation session.
