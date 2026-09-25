// Static maze layout (28 x 31). Rendering only — no game logic.
// #  wall    .  pellet    o  power pellet    -  ghost door    (space) empty
const LAYOUT = [
  "############################",
  "#............##............#",
  "#.####.#####.##.#####.####.#",
  "#o####.#####.##.#####.####o#",
  "#.####.#####.##.#####.####.#",
  "#..........................#",
  "#.####.##.########.##.####.#",
  "#.####.##.########.##.####.#",
  "#......##....##....##......#",
  "######.##### ## #####.######",
  "     #.##### ## #####.#     ",
  "     #.##          ##.#     ",
  "     #.## ###--### ##.#     ",
  "######.## #      # ##.######",
  "      .   #      #   .      ",
  "######.## #      # ##.######",
  "     #.## ######## ##.#     ",
  "     #.##          ##.#     ",
  "     #.## ######## ##.#     ",
  "######.## ######## ##.######",
  "#............##............#",
  "#.####.#####.##.#####.####.#",
  "#.####.#####.##.#####.####.#",
  "#o..##.......  .......##..o#",
  "###.##.##.########.##.##.###",
  "###.##.##.########.##.##.###",
  "#......##....##....##......#",
  "#.##########.##.##########.#",
  "#.##########.##.##########.#",
  "#..........................#",
  "############################",
];

const TILE_CLASS = {
  "#": "tile--wall",
  ".": "tile--pellet",
  "o": "tile--power",
  "-": "tile--door",
};

const board = document.getElementById("board");
const fragment = document.createDocumentFragment();

// Tile elements indexed as TILES[y][x], so game code can update them.
const TILES = LAYOUT.map((row, y) =>
  [...row].map((char, x) => {
    const tile = document.createElement("div");
    tile.className = "tile " + (TILE_CLASS[char] || "tile--empty");
    tile.style.gridArea = `${y + 1} / ${x + 1}`;
    fragment.appendChild(tile);
    return tile;
  })
);

board.prepend(fragment);
