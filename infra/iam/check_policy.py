#!/usr/bin/env python3
"""Check the dev deployer policy and the dev-stack guardrails.

The policy is a managed IAM policy, so the minified document must stay
within 6,144 characters. Allow statements stay on the dev stack. Deny
statements are what keep NAT, load balancers, billing, and secret reads out.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IAM_DIR = ROOT / "infra" / "iam"
POLICY_FILES = (
    "orbexa-dev-deployer-platform.json",
    "orbexa-dev-deployer-data.json",
    "orbexa-dev-deployer-identity.json",
)
TRUST_PATH = IAM_DIR / "orbexa-dev-github-oidc-trust.json"
ACCOUNT = "486726633485"

FORBIDDEN_ALLOW_PREFIXES = (
    "organizations:",
    "account:",
    "billing:",
    "aws-portal:",
    "ce:",
    "cur:",
    "payments:",
    "tax:",
    "invoicing:",
    "consolidatedbilling:",
    "elasticloadbalancing:",
    "wafv2:",
)

REQUIRED_DENY_SIDS = {
    "DenyNatAddressAndInstances",
    "DenyLoadBalancerAndWaf",
    "DenyOrgAndBilling",
    "DenySecretReadsAndWrites",
    "DenyIamUsersAndManagedPolicies",
    "DenyManagedPolicyAttachExceptEcsExecution",
    "DenyPassRoleExceptEcsTasks",
    "DenyLargerThanMicro",
}

IAM_STAR_ALLOW = {"iam:ListOpenIDConnectProviders"}


def as_list(value: str | list[str]) -> list[str]:
    if isinstance(value, str):
        return [value]
    return list(value)


def main() -> int:
    errors: list[str] = []
    policies = []
    for name in POLICY_FILES:
        document = json.loads((IAM_DIR / name).read_text())
        policies.append(document)
        minified = json.dumps(document, separators=(",", ":"))
        if len(minified) > 6144:
            errors.append(f"{name} minified size {len(minified)} exceeds 6144")
        if document.get("Version") != "2012-10-17":
            errors.append(f"{name} Version must be 2012-10-17")
        raw = (IAM_DIR / name).read_text()
        if "AdministratorAccess" in raw or "iam:*" in raw:
            errors.append(f"{name} grants an IAM wildcard or AdministratorAccess")
        if re.search(r'"Action"\s*:\s*"\*"', raw):
            errors.append(f"{name} contains Action *")
        account_ids = set(re.findall(r"\b\d{12}\b", raw))
        if account_ids != {ACCOUNT}:
            errors.append(f"{name} account ids {sorted(account_ids)} != {ACCOUNT}")

    trust = json.loads(TRUST_PATH.read_text())
    sids: set[str] = set()
    for policy in policies:
        for statement in policy["Statement"]:
            sid = statement.get("Sid", "")
            sids.add(sid)
            effect = statement["Effect"]
            for action in as_list(statement["Action"]):
                if effect != "Allow":
                    continue
                if action == "*" or action.endswith(":*"):
                    errors.append(f"{sid} allows {action}")
                for prefix in FORBIDDEN_ALLOW_PREFIXES:
                    if action.startswith(prefix):
                        errors.append(f"{sid} allows {action}")
                if action in {"secretsmanager:GetSecretValue", "secretsmanager:PutSecretValue"}:
                    errors.append(f"{sid} allows {action}")
                if action.startswith("iam:") and action not in IAM_STAR_ALLOW:
                    for resource in as_list(statement["Resource"]):
                        if resource == "*":
                            errors.append(f"{sid} allows {action} on *")

    missing = REQUIRED_DENY_SIDS - sids
    if missing:
        errors.append(f"missing deny statements: {', '.join(sorted(missing))}")

    statement = trust["Statement"][0]
    subject = statement["Condition"]["StringLike"]["token.actions.githubusercontent.com:sub"]
    audience = statement["Condition"]["StringEquals"]["token.actions.githubusercontent.com:aud"]
    if statement["Action"] != "sts:AssumeRoleWithWebIdentity":
        errors.append("OIDC trust action is not AssumeRoleWithWebIdentity")
    if audience != "sts.amazonaws.com":
        errors.append("OIDC audience is not sts.amazonaws.com")
    if subject != "repo:REPLACE_WITH_GITHUB_OWNER/orbexa:environment:dev":
        errors.append("OIDC subject must be the dev environment placeholder")
    if "*" in subject or "pull_request" in subject:
        errors.append("OIDC subject is wider than the dev environment")
    if ACCOUNT not in statement["Principal"]["Federated"]:
        errors.append("OIDC trust principal is not this account")

    dev_parts = [
        path.read_text()
        for path in sorted((ROOT / "infra" / "modules" / "dev-stack").glob("*.tf"))
    ]
    dev_parts.append((ROOT / "infra" / "envs" / "dev" / "backend.tf").read_text())
    dev_parts.append((ROOT / "infra" / "envs" / "dev" / "main.tf").read_text())
    dev_text = "\n".join(dev_parts)
    for banned in ("aws_nat_gateway", "aws_eip", "aws_lb", "aws_wafv2_web_acl"):
        if banned in dev_text:
            errors.append(f"dev stack contains {banned}")
    for required in (
        "db.t4g.micro",
        "storage_encrypted = true",
        "orbexa-dev-monthly-20",
        "orbexa-dev-monthly-50",
        "orbexa-dev-db-cpu",
        "environment:dev",
        "ap-southeast-2",
        ACCOUNT,
        "temporalio/temporal:1.10.1",
    ):
        if required not in dev_text:
            errors.append(f"dev stack is missing {required}")
    if "pull_request" in dev_text:
        errors.append("dev stack mentions pull_request in the OIDC trust")

    data_policy = (IAM_DIR / "orbexa-dev-deployer-data.json").read_text()
    if "secretsmanager:GetResourcePolicy" not in data_policy:
        errors.append("data policy is missing secretsmanager:GetResourcePolicy")

    for env in ("staging", "prod"):
        guard = (ROOT / "infra" / "envs" / env / "account_guard.tf").read_text()
        if ACCOUNT not in guard or "!=" not in guard:
            errors.append(f"{env} does not refuse the dev account")

    for path in (ROOT / "infra").rglob("*"):
        if not path.is_file() or ".terraform" in path.parts or "__pycache__" in path.parts:
            continue
        if path.suffix in {".tfstate", ".zip", ".pyc"} or path.name == "check_policy.py":
            continue
        body = path.read_text(errors="ignore")
        if any(token in body for token in ("sk_live_", "AKIA", "BEGIN RSA PRIVATE", "BEGIN OPENSSH PRIVATE")):
            errors.append(f"secret-like text in {path.relative_to(ROOT)}")

    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print("ok " + " ".join(POLICY_FILES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
