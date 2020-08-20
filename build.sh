#!/usr/bin/env bash

# Compile the TypeScript into Javascript and write it to ./dist.
tsc

# SAM build requires the NPM package.json to exist.
cp package.json dist/package.json

# Remove all of our tests from the distibution.
# There's no need to keep these around in production.
rm -rf dist/*.test.*

# Copy configuration files into the distribution.
cp -r configs dist

# Build the AWS SAM Application
sam build
