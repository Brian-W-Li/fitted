/** A durable owner write, shared with transactional image admission. Never clear this barrier. */
export type ErasureOwner = {
  updateOne: (
    filter: Record<string, unknown>, update: Record<string, unknown>,
    options: { writeConcern: { w: "majority" } },
  ) => PromiseLike<{ matchedCount: number }>;
};

export async function beginUserErasure(User: ErasureOwner, userId: unknown): Promise<boolean> {
  const result = await User.updateOne(
    { _id: userId }, { $set: { erasureStarted: true } },
    { writeConcern: { w: "majority" } },
  );
  // A rejected/unknown acknowledgment must halt the cascade; retry writes the same barrier.
  return result.matchedCount > 0;
}
