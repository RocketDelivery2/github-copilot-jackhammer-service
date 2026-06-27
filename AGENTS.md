cd C:\Users\codin\source\repos\github-copilot-jackhammer-service

git checkout main
git pull --ff-only
git checkout -b jh/repository-agents-instructions

Set-Content -Path .\AGENTS.md -Value (Get-Clipboard) -Encoding UTF8

Get-Content .\AGENTS.md -TotalCount 20
git status --short --branch
