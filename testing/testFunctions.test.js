/* Test functions for the functions located in testFunctions.js file.
 *
 * The type of the test functions are listed as follow accordingly to the listed test functions:
 * Unit testing: 1 - ???
 * Integration testing: ??? - ???
 * End to end testing: ??? - ???
 *
*/

const puppeteer = require("puppeteer");


/*  Unit test for convert function */
const {convert} = require("./testFunctions");

test('should output date in a converted format', () => {
    let date = new Date("Thu May 14 2020 11:10:46 GMT+0200 (Central European Summer Time)");
    const text = convert(date);
    expect(text).toBe('2020-05-14');
});


/*  End to end test with sortTable  */
const {sortTable} = require("./testFunctions");

test("should sort the table in regards to the title", async () => {
    const browser = await puppeteer.launch({
        headless: false,
        slowMo: 20,
        args: ["--window-size=1920,1080"]
    })
    const page = await browser.newPage();
    await page.goto(
        "file:///C:/Users/fred7/Documents/GitHub/P2-Emergency-Help-Desk/testing/tests.html"
    );

    await page.click("#sort");

    const title1 = await page.$eval('#titleElement1', el => el.textContent);
    const title2 = await page.$eval('#titleElement2', el => el.textContent);
    const title3 = await page.$eval('#titleElement3', el => el.textContent);
    const title4 = await page.$eval('#titleElement4', el => el.textContent);

    const titleArr = [title3, title1, title2, title4];

    const expectedArr = ["Burger King", "Corona", "McDonalds", "Sunset"];

    expect(titleArr).toStrictEqual(expectedArr);

    await browser.close();
});
