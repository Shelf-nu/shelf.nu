/** Generates a random username based on the email and 3 random numbers
 * @param email string
 * @return username
 */
export const randomUsernameFromEmail = (email: string): string =>
  `${email.split("@")[0]}${Math.floor(Math.random() * 999)}`;
