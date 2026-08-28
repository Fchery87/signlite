let openModalCount = 0;

/** Registers an open Modal. Returns the matching release. */
export function registerOpenModal() {
  openModalCount += 1;
  return () => {
    openModalCount -= 1;
  };
}

/** True while any Modal is open, so global shortcuts can stand down. */
export function isAnyModalOpen() {
  return openModalCount > 0;
}
