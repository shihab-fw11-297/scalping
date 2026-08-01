export class FixedMinHeap<T> {
  private readonly values: T[] = [];

  constructor(
    private readonly capacity: number,
    private readonly score: (value: T) => number,
  ) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("Heap capacity must be a positive integer.");
    }
  }

  push(value: T): void {
    if (this.values.length < this.capacity) {
      this.values.push(value);
      this.bubbleUp(this.values.length - 1);
      return;
    }

    if (this.score(value) <= this.score(this.values[0])) return;
    this.values[0] = value;
    this.bubbleDown(0);
  }

  toDescendingArray(): T[] {
    return [...this.values].sort((a, b) => this.score(b) - this.score(a));
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.score(this.values[parent]) <= this.score(this.values[index])) return;
      [this.values[parent], this.values[index]] = [
        this.values[index],
        this.values[parent],
      ];
      index = parent;
    }
  }

  private bubbleDown(index: number): void {
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (
        left < this.values.length &&
        this.score(this.values[left]) < this.score(this.values[smallest])
      ) {
        smallest = left;
      }
      if (
        right < this.values.length &&
        this.score(this.values[right]) < this.score(this.values[smallest])
      ) {
        smallest = right;
      }
      if (smallest === index) return;
      [this.values[smallest], this.values[index]] = [
        this.values[index],
        this.values[smallest],
      ];
      index = smallest;
    }
  }
}
