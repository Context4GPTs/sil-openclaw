#!/usr/bin/env python3
"""
Repository Analyzer for Agent Config Generation

Analyzes a repository to extract information useful for generating
CLAUDE.md and AGENTS.md files.

Usage:
    python analyze_repo.py [path]

Output:
    JSON object with detected stack, structure, commands, and conventions.
"""

import json
import os
import sys
from pathlib import Path


def detect_package_manager(repo_path: Path) -> str | None:
    """Detect the package manager used in the repository."""
    markers = {
        "pnpm-lock.yaml": "pnpm",
        "yarn.lock": "yarn",
        "bun.lockb": "bun",
        "package-lock.json": "npm",
        "uv.lock": "uv",
        "poetry.lock": "poetry",
        "Pipfile.lock": "pipenv",
        "requirements.txt": "pip",
        "go.sum": "go",
        "Cargo.lock": "cargo",
    }

    for marker, manager in markers.items():
        if (repo_path / marker).exists():
            return manager
    return None


def detect_languages(repo_path: Path) -> list[str]:
    """Detect programming languages used in the repository."""
    language_markers = {
        "TypeScript": ["tsconfig.json", "*.ts", "*.tsx"],
        "JavaScript": ["*.js", "*.jsx", "*.mjs"],
        "Python": ["*.py", "pyproject.toml", "setup.py"],
        "Go": ["go.mod", "*.go"],
        "Rust": ["Cargo.toml", "*.rs"],
        "Ruby": ["Gemfile", "*.rb"],
        "Java": ["pom.xml", "build.gradle", "*.java"],
        "C#": ["*.csproj", "*.cs"],
        "PHP": ["composer.json", "*.php"],
    }

    detected = []
    for lang, markers in language_markers.items():
        for marker in markers:
            if marker.startswith("*"):
                # Check for file extension
                ext = marker[1:]
                if any(repo_path.rglob(f"*{ext}")):
                    detected.append(lang)
                    break
            elif (repo_path / marker).exists():
                detected.append(lang)
                break

    return detected


def detect_frameworks(repo_path: Path) -> list[str]:
    """Detect frameworks used in the repository."""
    frameworks = []

    # Check package.json for JS frameworks
    pkg_json = repo_path / "package.json"
    if pkg_json.exists():
        try:
            with open(pkg_json) as f:
                pkg = json.load(f)
            deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}

            framework_markers = {
                "next": "Next.js",
                "react": "React",
                "vue": "Vue",
                "svelte": "Svelte",
                "@angular/core": "Angular",
                "express": "Express",
                "fastify": "Fastify",
                "hono": "Hono",
                "nest": "NestJS",
            }

            for marker, name in framework_markers.items():
                if marker in deps:
                    frameworks.append(name)
        except (json.JSONDecodeError, IOError):
            pass

    # Check pyproject.toml for Python frameworks
    pyproject = repo_path / "pyproject.toml"
    if pyproject.exists():
        try:
            content = pyproject.read_text()
            py_frameworks = {
                "fastapi": "FastAPI",
                "django": "Django",
                "flask": "Flask",
                "starlette": "Starlette",
            }
            for marker, name in py_frameworks.items():
                if marker in content.lower():
                    frameworks.append(name)
        except IOError:
            pass

    return frameworks


def extract_scripts(repo_path: Path) -> dict[str, str]:
    """Extract npm/yarn scripts from package.json."""
    pkg_json = repo_path / "package.json"
    if pkg_json.exists():
        try:
            with open(pkg_json) as f:
                pkg = json.load(f)
            return pkg.get("scripts", {})
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def detect_test_framework(repo_path: Path) -> str | None:
    """Detect the test framework used."""
    pkg_json = repo_path / "package.json"
    if pkg_json.exists():
        try:
            with open(pkg_json) as f:
                pkg = json.load(f)
            deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}

            test_frameworks = ["vitest", "jest", "mocha", "ava", "playwright", "cypress"]
            for fw in test_frameworks:
                if fw in deps:
                    return fw
        except (json.JSONDecodeError, IOError):
            pass

    # Python
    if (repo_path / "pytest.ini").exists() or (repo_path / "pyproject.toml").exists():
        pyproject = repo_path / "pyproject.toml"
        if pyproject.exists():
            try:
                content = pyproject.read_text()
                if "pytest" in content:
                    return "pytest"
            except IOError:
                pass

    return None


def detect_linter(repo_path: Path) -> str | None:
    """Detect the linter/formatter used."""
    linter_markers = {
        ".eslintrc": "eslint",
        ".eslintrc.js": "eslint",
        ".eslintrc.json": "eslint",
        "eslint.config.js": "eslint",
        "eslint.config.mjs": "eslint",
        "biome.json": "biome",
        ".prettierrc": "prettier",
        "prettier.config.js": "prettier",
        "ruff.toml": "ruff",
        ".ruff.toml": "ruff",
    }

    for marker, linter in linter_markers.items():
        if (repo_path / marker).exists():
            return linter

    # Check pyproject.toml for ruff
    pyproject = repo_path / "pyproject.toml"
    if pyproject.exists():
        try:
            content = pyproject.read_text()
            if "[tool.ruff]" in content:
                return "ruff"
        except IOError:
            pass

    return None


def get_directory_structure(repo_path: Path, max_depth: int = 2) -> dict:
    """Get a simplified directory structure."""
    structure = {}

    ignore_dirs = {
        "node_modules", ".git", "__pycache__", ".next", "dist",
        "build", ".turbo", "coverage", ".pytest_cache", "venv",
        ".venv", "target", ".idea", ".vscode"
    }

    def scan_dir(path: Path, depth: int) -> dict | None:
        if depth > max_depth:
            return None

        result = {}
        try:
            for item in sorted(path.iterdir()):
                if item.name.startswith(".") or item.name in ignore_dirs:
                    continue
                if item.is_dir():
                    sub = scan_dir(item, depth + 1)
                    if sub is not None:
                        result[item.name + "/"] = sub
                    else:
                        result[item.name + "/"] = "..."
        except PermissionError:
            return None

        return result if result else None

    return scan_dir(repo_path, 0) or {}


def detect_database(repo_path: Path) -> str | None:
    """Detect database ORM/driver used."""
    pkg_json = repo_path / "package.json"
    if pkg_json.exists():
        try:
            with open(pkg_json) as f:
                pkg = json.load(f)
            deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
            db_markers = {
                "prisma": "Prisma",
                "@prisma/client": "Prisma",
                "drizzle-orm": "Drizzle",
                "typeorm": "TypeORM",
                "sequelize": "Sequelize",
                "mongoose": "Mongoose",
            }
            for marker, name in db_markers.items():
                if marker in deps:
                    return name
        except (json.JSONDecodeError, IOError):
            pass

    pyproject = repo_path / "pyproject.toml"
    if pyproject.exists():
        try:
            content = pyproject.read_text().lower()
            if "sqlalchemy" in content:
                return "SQLAlchemy"
            if "django" in content:
                return "Django ORM"
            if "tortoise" in content:
                return "Tortoise ORM"
        except IOError:
            pass

    if (repo_path / "go.mod").exists():
        try:
            content = (repo_path / "go.mod").read_text()
            if "gorm.io" in content:
                return "GORM"
        except IOError:
            pass

    if (repo_path / "Cargo.toml").exists():
        try:
            content = (repo_path / "Cargo.toml").read_text().lower()
            if "diesel" in content:
                return "Diesel"
            if "sqlx" in content:
                return "SQLx"
        except IOError:
            pass

    return None


def detect_ci_provider(repo_path: Path) -> str | None:
    """Detect CI/CD provider."""
    if (repo_path / ".github" / "workflows").is_dir():
        return "GitHub Actions"
    if (repo_path / ".gitlab-ci.yml").exists():
        return "GitLab CI"
    if (repo_path / ".circleci").is_dir():
        return "CircleCI"
    if (repo_path / "Jenkinsfile").exists():
        return "Jenkins"
    return None


def detect_containerization(repo_path: Path) -> list[str]:
    """Detect containerization tools."""
    found = []
    if (repo_path / "Dockerfile").exists() or any(repo_path.glob("*.Dockerfile")):
        found.append("Docker")
    if any(repo_path.glob("docker-compose*.yml")) or any(repo_path.glob("docker-compose*.yaml")):
        found.append("docker-compose")
    if (repo_path / ".devcontainer").is_dir():
        found.append("devcontainer")
    return found


def detect_monorepo_tool(repo_path: Path) -> str | None:
    """Detect monorepo management tool."""
    if (repo_path / "turbo.json").exists():
        return "Turborepo"
    if (repo_path / "nx.json").exists():
        return "Nx"
    if (repo_path / "lerna.json").exists():
        return "Lerna"
    if (repo_path / "pnpm-workspace.yaml").exists():
        return "pnpm workspaces"
    return None


def detect_claude_config(repo_path: Path) -> dict:
    """Detect existing .claude/ configuration."""
    claude_dir = repo_path / ".claude"
    config = {
        "has_settings": (claude_dir / "settings.json").exists(),
        "has_hooks": (claude_dir / "hooks").is_dir() and any((claude_dir / "hooks").iterdir()) if (claude_dir / "hooks").is_dir() else False,
        "has_skills": (claude_dir / "skills").is_dir() and any((claude_dir / "skills").iterdir()) if (claude_dir / "skills").is_dir() else False,
        "has_agents": (claude_dir / "agents").is_dir() and any((claude_dir / "agents").iterdir()) if (claude_dir / "agents").is_dir() else False,
    }
    return config


def suggest_rules_domains(repo_path: Path) -> list[str]:
    """Suggest which .claude/rules/ domains apply based on directory structure."""
    domains = []

    api_dirs = ["src/api", "src/routes", "app/api", "api"]
    if any((repo_path / d).is_dir() for d in api_dirs):
        domains.append("api-rules")

    test_markers = ["tests", "test", "__tests__"]
    has_test_dir = any((repo_path / d).is_dir() for d in test_markers)
    has_test_files = any(repo_path.rglob("*.test.*")) or any(repo_path.rglob("*.spec.*"))
    if has_test_dir or has_test_files:
        domains.append("test-rules")

    component_dirs = ["src/components", "components", "app/components"]
    has_components = any((repo_path / d).is_dir() for d in component_dirs)
    has_tsx = any(repo_path.rglob("*.tsx")) or any(repo_path.rglob("*.jsx"))
    if has_components or has_tsx:
        domains.append("component-rules")

    infra_markers = [".github", "Dockerfile"]
    has_infra = any((repo_path / m).exists() for m in infra_markers)
    has_tf = any(repo_path.rglob("*.tf"))
    if has_infra or has_tf:
        domains.append("infra-rules")

    return domains


def suggest_deny_list(languages: list[str], containerization: list[str]) -> list[str]:
    """Suggest additional deny list entries based on detected tools."""
    deny = []
    if "JavaScript" in languages or "TypeScript" in languages:
        deny.append("Bash(npm publish*)")
    if "Python" in languages:
        deny.append("Bash(pip upload*)")
    if "Docker" in containerization:
        deny.append("Bash(docker push*)")
    return deny


def analyze_repo(repo_path: str | None = None) -> dict:
    """Analyze a repository and return structured information."""
    path = Path(repo_path) if repo_path else Path.cwd()

    if not path.exists():
        return {"error": f"Path does not exist: {path}"}

    project_name = path.name
    pkg_json = path / "package.json"
    if pkg_json.exists():
        try:
            with open(pkg_json) as f:
                pkg = json.load(f)
            project_name = pkg.get("name", project_name)
        except (json.JSONDecodeError, IOError):
            pass

    languages = detect_languages(path)
    containerization = detect_containerization(path)

    return {
        "project_name": project_name,
        "path": str(path.absolute()),
        "package_manager": detect_package_manager(path),
        "languages": languages,
        "frameworks": detect_frameworks(path),
        "test_framework": detect_test_framework(path),
        "linter": detect_linter(path),
        "database": detect_database(path),
        "ci_provider": detect_ci_provider(path),
        "containerization": containerization,
        "monorepo_tool": detect_monorepo_tool(path),
        "claude_config": detect_claude_config(path),
        "scripts": extract_scripts(path),
        "structure": get_directory_structure(path),
        "has_readme": (path / "README.md").exists() or (path / "readme.md").exists(),
        "has_contributing": (path / "CONTRIBUTING.md").exists(),
        "has_claude_md": (path / "CLAUDE.md").exists(),
        "has_agents_md": (path / "AGENTS.md").exists(),
        "has_env_example": (path / ".env.example").exists() or (path / ".env.sample").exists(),
        "is_monorepo": detect_monorepo_tool(path) is not None,
        "suggested_rules_domains": suggest_rules_domains(path),
        "suggested_deny_list": suggest_deny_list(languages, containerization),
    }


def main():
    repo_path = sys.argv[1] if len(sys.argv) > 1 else None
    result = analyze_repo(repo_path)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
