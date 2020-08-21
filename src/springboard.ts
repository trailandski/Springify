import axios from "axios";

export const createSpringboardApiClient = () => axios.create({
    baseURL: `https://${process.env.SpringboardSubDomain}.myspringboard.us/api`,
    headers: {
        Authorization: `Bearer ${process.env.SpringboardToken}`
    }
});

export const attachItemDetails = async (item) => {
    const springboard = createSpringboardApiClient();
    if (item.primary_vendor_id) {
        item.primary_vendor = (await springboard.get(`purchasing/vendors/${item.primary_vendor_id}`)).data
    }

    if (item.primary_image_id) {
        try {
            item.primary_image = (await springboard.get(`items/${item.id}/images/${item.primary_image_id}`)).data;
        } catch (error) {
            console.error(`Item #${item.public_id} referred an image that did not actually exist.`);
            console.error(error)
        }

    }
};

export const attachItemGrid = async (item) => {
    const springboard = createSpringboardApiClient();
    if (item.grid_id) {
        item.grid = (await springboard.get(`item_grids/${item.grid_id}`)).data;
    }
};
