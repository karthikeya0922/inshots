const toggle = document.getElementById("toggle");
if (toggle) {
  toggle.addEventListener("click", () => {
    document.querySelectorAll("#outline ul").forEach((ul) => ul.classList.toggle("folded"));
    toggle.textContent = toggle.textContent === "Fold all" ? "Unfold all" : "Fold all";
  });
}
