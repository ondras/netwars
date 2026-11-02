import { Game, type LevelResult } from "./game.ts";
import { LEVELS } from "./levels.ts";
import { Menu, type ResultAction } from "./menu.ts";

const game = new Game(document.querySelector<HTMLElement>("#game")!);
const menu = new Menu(LEVELS);

function play(level: number): void {
	menu.hideResult();
	document.body.classList.add("playing");
	game.start(level);
}

function backToMenu(level: number): void {
	game.stop();
	document.body.classList.remove("playing");
	menu.show(level);
}

menu.onStart = play;

game.onOutcome = ({ level, outcome, podsLeft, podsTotal }: LevelResult) => {
	document.body.classList.remove("playing"); /* show the cursor for the buttons */
	const toMenu: ResultAction = { label: "Menu", action: () => backToMenu(level) };

	switch (outcome) {
		case "won": {
			const next = level + 1;
			const proceed: ResultAction = (next < LEVELS.length
				? { label: "Next level", action: () => play(next) }
				: { label: "Play again", action: () => play(0) });
			const last = (next < LEVELS.length ? "" : " That was the last level.");
			menu.showResult(`Level ${level + 1} complete`, `Pods saved: ${podsLeft} of ${podsTotal}.${last}`, [proceed, toMenu]);
		} break;

		case "ship-destroyed":
			menu.showResult("Ship destroyed", `Level ${level + 1}: ${LEVELS[level].name}`, [{ label: "Retry", action: () => play(level) }, toMenu]);
		break;

		case "pods-lost":
			menu.showResult("All pods lost", `Level ${level + 1}: ${LEVELS[level].name}`, [{ label: "Retry", action: () => play(level) }, toMenu]);
		break;
	}
};

window.addEventListener("keydown", e => {
	if (e.key == "Escape" && game.level !== null) { backToMenu(game.level); }
	if (e.key == "Enter" && menu.visible && !(document.activeElement instanceof HTMLButtonElement)) { menu.start(); }
});

menu.show(0);
