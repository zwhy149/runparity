// RunParity backend qualification probe: credential and socket absence facts.
// Checks NAME PRESENCE ONLY. It never reads or emits any credential value.
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";

const ENV_NAMES = [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "SSH_AUTH_SOCK",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "NPM_TOKEN",
  "CI_TOKEN",
];

const envPresence = ENV_NAMES.map((name) => ({
  name,
  present: typeof process.env[name] === "string" && process.env[name] !== "",
}));

const home = homedir();
const PATH_CHECKS = [
  { name: "docker_engine_socket", path: "/var/run/docker.sock" },
  { name: "docker_socket_alt", path: "/run/docker.sock" },
  { name: "ssh_directory", path: `${home}/.ssh` },
  { name: "gpg_directory", path: `${home}/.gnupg` },
  { name: "aws_directory", path: `${home}/.aws` },
  { name: "kube_directory", path: `${home}/.kube` },
];

const pathPresence = PATH_CHECKS.map((check) => {
  let present = false;
  try {
    accessSync(check.path, constants.F_OK);
    present = true;
  } catch {
    present = false;
  }
  return { name: check.name, path: check.path, present };
});

process.stdout.write(
  `${JSON.stringify({
    schema_version: "runparity.backend-probe/credentials/v1",
    environment: envPresence,
    paths: pathPresence,
  })}\n`,
);
