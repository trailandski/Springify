import axios from "axios";

export const createSpringboardApiClient = () => axios.create({
    baseURL: `https://${process.env.SpringboardSubDomain}.myspringboard.us/api`,
    headers: {
        Authorization: `Bearer ${process.env.SpringboardToken}`
    }
});
