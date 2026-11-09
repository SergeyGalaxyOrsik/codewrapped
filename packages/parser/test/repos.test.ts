import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGitRepoResolver, repoNameFromPath, repoNameFromUrl } from "../src/index";

describe("repoNameFromUrl", () => {
  it("keeps only the repository name", () => {
    expect(repoNameFromUrl("git@github.com:acme/payments-api.git")).toBe("payments-api");
    expect(repoNameFromUrl("https://github.com/acme/web/")).toBe("web");
    expect(repoNameFromUrl("ssh://git@gitlab.example.com:2222/group/sub/tool.git")).toBe("tool");
    expect(repoNameFromUrl("/srv/git/notes.git")).toBe("notes");
  });

  it("never returns credentials from the URL", () => {
    expect(repoNameFromUrl("https://user:token@host/owner/repo.git")).toBe("repo");
    expect(repoNameFromUrl("https://x-access-token:ghp_secret@github.com/owner/repo")).toBe("repo");
    expect(repoNameFromUrl("https://user:token@host/owner/repo.git?ref=main#readme")).toBe("repo");
    // No path at all: nothing to name, and the userinfo must not leak as the name.
    expect(repoNameFromUrl("https://user:token@host")).toBeNull();
    expect(repoNameFromUrl("https://user:token@host/")).toBeNull();
    expect(repoNameFromUrl("user:token@host")).toBeNull();
  });
});

describe("repoNameFromPath", () => {
  it("maps agent worktrees to their repository and drops temporary folders", () => {
    expect(repoNameFromPath("/Users/me/dev/shop")).toBe("shop");
    expect(repoNameFromPath("C:\\Users\\me\\shop\\")).toBe("shop");
    expect(repoNameFromPath("/Users/me/shop/.claude/worktrees/fix-nav")).toBe("shop");
    expect(repoNameFromPath("/Users/me/.codex/worktrees/a1b2/shop")).toBe("shop");
    expect(repoNameFromPath("/private/tmp/scratch")).toBeNull();
    expect(repoNameFromPath(null)).toBeNull();
  });
});

describe("createGitRepoResolver", () => {
  // Existing folders are resolved through git, so the temp-folder rule does not apply to them.
  const setup = async () => realpath(await mkdtemp(join(tmpdir(), "cw-repos-")));

  it("reads the origin remote and resolves subfolders, worktrees and plain folders", async () => {
    const base = await setup();
    // Main checkout with a remote.
    const main = join(base, "checkout");
    await mkdir(join(main, ".git", "worktrees", "wt1"), { recursive: true });
    await mkdir(join(main, "packages", "web"), { recursive: true });
    await writeFile(join(main, ".git", "config"), '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:acme/payments-api.git\n');
    // A worktree elsewhere that points back at the main repository.
    const wt = join(base, "wt1");
    await mkdir(wt, { recursive: true });
    await writeFile(join(wt, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt1")}\n`);
    await writeFile(join(main, ".git", "worktrees", "wt1", "commondir"), "../..\n");
    // A repository without a remote.
    const local = join(base, "notes-repo");
    await mkdir(join(local, ".git"), { recursive: true });
    await writeFile(join(local, ".git", "config"), "[core]\n\tbare = false\n");
    // A remote with credentials in the URL.
    const withToken = join(base, "token-checkout");
    await mkdir(join(withToken, ".git"), { recursive: true });
    await writeFile(join(withToken, ".git", "config"), '[remote "origin"]\n\turl = https://user:token@host/owner/repo.git\n');
    // A folder that is not a repository.
    const plain = join(base, "plain");
    await mkdir(plain);

    const resolve = createGitRepoResolver();
    expect(resolve(main)).toBe("payments-api");
    expect(resolve(join(main, "packages", "web"))).toBe("payments-api");
    expect(resolve(wt)).toBe("payments-api");
    expect(resolve(local)).toBe("notes-repo");
    expect(resolve(withToken)).toBe("repo");
    // The temp dir itself is inside no repository.
    expect(resolve(plain)).toBeNull();
    // Gone folders fall back to the path.
    expect(resolve("/Users/nobody/dev/old-app")).toBe("old-app");
  });

  it("reads the remote url the way git does", async () => {
    const base = await setup();
    const configs: Record<string, string> = {
      quoted: '[remote "origin"]\n\turl = "https://user:token@github.com/o/quoted-name.git"\n',
      hashComment: '[remote "origin"]\n\turl = git@github.com:o/hash-name.git # mirror\n',
      semicolonComment: '[remote "origin"]\n\turl = git@github.com:o/semi-name.git ; mirror\n',
      quotedSemicolon: '[remote "origin"]\n\turl = "https://github.com/o/semi;colon-name.git"\n',
      upperCase: '[Remote "origin"]\n\tURL = https://github.com/o/upper-name.git\n',
      oldForm: "[remote.origin]\n\turl = https://github.com/o/old-form.git\n",
      ipv6First: '[remote "origin"]\n\turl = https://[::1]/o/v6-name.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
      originAfterOther: '[remote "upstream"]\n\turl = https://github.com/o/upstream-name.git\n[remote "origin"]\n\turl = https://github.com/o/origin-name.git\n',
      onlyOther: '[remote "upstream"]\n\turl = https://github.com/o/only-upstream.git\n',
      pushurlFirst: '[remote "origin"]\n\tpushurl = https://github.com/o/push-name.git\n\turl = https://github.com/o/fetch-name.git\n',
      otherSection: '[url "https://github.com/"]\n\tinsteadOf = gh:\n[branch "main"]\n\tremote = origin\n\turl = https://github.com/o/not-a-remote.git\n',
    };
    const resolve = createGitRepoResolver();
    const names: Record<string, string | null> = {};
    for (const [name, config] of Object.entries(configs)) {
      await mkdir(join(base, name, ".git"), { recursive: true });
      await writeFile(join(base, name, ".git", "config"), config);
      names[name] = resolve(join(base, name));
    }
    expect(names).toEqual({
      quoted: "quoted-name",
      hashComment: "hash-name",
      semicolonComment: "semi-name",
      quotedSemicolon: "semi;colon-name",
      upperCase: "upper-name",
      oldForm: "old-form",
      ipv6First: "v6-name",
      originAfterOther: "origin-name",
      onlyOther: "only-upstream",
      pushurlFirst: "fetch-name",
      otherSection: "otherSection",
    });
  });
});
