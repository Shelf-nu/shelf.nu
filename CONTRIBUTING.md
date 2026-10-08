# Contribute to Shelf

We really appreciate your interest to contribute to Shelf! Any kind of contribution is highly appreciated, not only coding ☺️.
Wondering what is up for grabs? Check out those issues: https://github.com/Shelf-nu/shelf.nu/labels/Open%20for%20contibutions

**Prerequisites:** Node 22.20.0 (or newer) and pnpm installed on your computer.

1. Fork this [repository](https://github.com/Shelf-nu/shelf.nu) and clone your fork.
2. Follow the [Get started guide](https://docs.shelf.nu/local-development) to setup your local repository.
3. Make any changes you consider to the project.
4. Make sure tests pass by running `pnpm webapp:validate`
5. Craft your commit message using the [Conventional Commits](https://www.conventionalcommits.org/) format. The `commit-msg` hook runs `commitlint` automatically to ensure your message follows the convention.
6. Commit and push to your fork.
7. Open a Pull Request detailing the changes.
8. Request a review from someone in the shelf team

If you get stuck on any of these steps, open an issue or join us in our [Discord](https://discord.gg/8he9W7aTJu) for some extra help.

## Contributions to the companion app

The companion mobile app in `apps/companion/` is not under AGPL-3.0. It has its [own license](./apps/companion/LICENSE), which does not allow distribution.

- **Forking and cloning are fine.** You can fork this repository on GitHub and clone your fork to contribute to the rest of Shelf, even though both copies contain `apps/companion/`. GitHub's [Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#5-license-grant-to-other-users) let every user fork a public repository, and we allow the local clone that the steps above need. The companion license applies to anything else you do with that folder.
- **Changes to `apps/companion/` need an agreement first.** We can accept a pull request that changes files in that folder only under a separate written agreement with Shelf Asset Management, Inc. Please open an issue before you start work there.
