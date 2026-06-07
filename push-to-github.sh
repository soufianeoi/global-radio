#!/bin/bash
# Global Radio — Push to GitHub
# WARNING: Do NOT hardcode tokens in this file.
# Use `gh auth login` or pass your token via environment variable.

USERNAME="soufianeoi"
REPO_NAME="global-radio"

echo "Creating repo on GitHub..."
gh repo create "$REPO_NAME" --public --description "Global Radio — 3D globe internet radio explorer" || echo "Repo may already exist"

echo "Pushing code..."
git remote remove origin 2>/dev/null
git remote add origin "https://github.com/${USERNAME}/${REPO_NAME}.git"
git push -u origin main --force

echo "Done! https://github.com/$USERNAME/$REPO_NAME"
